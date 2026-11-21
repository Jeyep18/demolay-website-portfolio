import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { join } from "node:path";

// Docker Desktop can ignore a bridge's default binding; set each published HostIp explicitly.
const docker =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA, "Programs/DockerDesktop/resources/bin/docker.exe")
    : "docker";
const run = (...args) =>
  execFileSync(docker, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const inspect = (name) => JSON.parse(run("inspect", name))[0];
const context = JSON.parse(run("context", "inspect"))[0].Endpoints.docker.Host;
if (!context.startsWith("npipe:") && !context.startsWith("unix:"))
  throw new Error("Only a local Docker engine is allowed.");
const socketPath = context.startsWith("npipe:")
  ? context.slice("npipe:////./pipe/".length).replace(/^/, "\\\\.\\pipe\\")
  : new URL(context).pathname;
const api = (path, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        socketPath,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          res.statusCode < 300
            ? resolve()
            : reject(
                new Error(
                  `Local Docker operation failed (${res.statusCode}); services remain stopped.`,
                ),
              ),
        );
      },
    );
    req.setTimeout(15000, () => req.destroy(new Error("Local Docker operation timed out.")));
    req.on("error", reject);
    req.end(data);
  });

for (const component of ["db", "kong"]) {
  const name = `supabase_${component}_demolay-local-test`;
  const old = inspect(name);
  assert.equal(old.Config.Labels["com.supabase.cli.project"], "demolay-local-test");
  const bindings = old.HostConfig.PortBindings;
  assert.ok(bindings && Object.keys(bindings).length > 0);
  if (Object.values(bindings).every((list) => list.every((item) => item.HostIp === "127.0.0.1")))
    continue;
  assert.equal(
    old.State.Running,
    false,
    "Stop the local gateway and database before restricting ports.",
  );
  const config = {
    ...old.Config,
    HostConfig: {
      ...old.HostConfig,
      PortBindings: Object.fromEntries(
        Object.entries(bindings).map(([port, list]) => [
          port,
          list.map((item) => ({ ...item, HostIp: "127.0.0.1" })),
        ]),
      ),
    },
    NetworkingConfig: {
      EndpointsConfig: Object.fromEntries(
        Object.entries(old.NetworkSettings.Networks).map(([network, settings]) => [
          network,
          { Aliases: settings.Aliases },
        ]),
      ),
    },
  };
  assert.deepEqual(config.Env, old.Config.Env);
  assert.deepEqual(config.HostConfig.Binds, old.HostConfig.Binds);
  const backup = `${name}-unbound-stopped`;
  run("rename", name, backup);
  try {
    await api(`/containers/create?name=${encodeURIComponent(name)}`, config);
  } catch (error) {
    run("rename", backup, name);
    throw error;
  }
  if (component === "kong") {
    // The CLI copies gateway configuration into the container's writable layer.
    const archive = execFileSync(docker, ["cp", `${backup}:/home/kong/.`, "-"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    try {
      execFileSync(docker, ["cp", "-", `${name}:/home/kong/`], {
        input: archive,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      throw new Error("Gateway configuration copy failed; leave the local gateway stopped.");
    }
  }
  const created = inspect(name);
  assert.deepEqual(created.Config.Env, old.Config.Env);
  assert.deepEqual(created.HostConfig.Binds, old.HostConfig.Binds);
  assert.ok(
    Object.values(created.HostConfig.PortBindings).every((list) =>
      list.every((item) => item.HostIp === "127.0.0.1"),
    ),
  );
}
for (const component of ["db", "kong"]) run("start", `supabase_${component}_demolay-local-test`);
for (const component of ["db", "kong"]) {
  const current = inspect(`supabase_${component}_demolay-local-test`);
  assert.ok(
    Object.values(current.NetworkSettings.Ports)
      .filter(Boolean)
      .flat()
      .every((item) => item.HostIp === "127.0.0.1"),
  );
}
console.log(
  "Local database and gateway explicitly bound to 127.0.0.1; stopped originals retained for recovery.",
);
