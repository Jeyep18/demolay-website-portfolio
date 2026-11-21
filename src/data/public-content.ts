// Shared public content and financial records.
export const reportAsOf = "2026-10-15";
export const chapterContact = {
  email: "nagacitychapter120@gmail.com",
  facebook: "https://www.facebook.com/profile.php?id=61568910982860",
};
export type Photo = { src: string; alt: string; width: number; height: number; caption: string };
export const photos: Photo[] = [
  {
    src: "/images/molay/installation-officers.webp",
    alt: "Chapter officers gathered around a ceremonial dais",
    width: 1600,
    height: 1066,
    caption: "Chapter officers gathered around the ceremonial dais.",
  },
  {
    src: "/images/molay/officers-three.webp",
    alt: "Three chapter officers standing together",
    width: 1600,
    height: 1066,
    caption: "Chapter officers together in ceremonial regalia.",
  },
  {
    src: "/images/molay/installation-ceremony-01.webp",
    alt: "Members participating in a chapter ceremony",
    width: 1600,
    height: 1066,
    caption: "Members taking part in a chapter ceremony.",
  },
  {
    src: "/images/molay/installation-handover.webp",
    alt: "A ceremonial gavel handover",
    width: 1600,
    height: 1066,
    caption: "The ceremonial handover of the gavel.",
  },
  {
    src: "/images/molay/installation-ceremony-02.webp",
    alt: "A moment from the supplied chapter ceremony",
    width: 1600,
    height: 1067,
    caption: "A moment from the chapter ceremony.",
  },
  {
    src: "/images/molay/regalia-detail.webp",
    alt: "Embroidered details of chapter regalia",
    width: 1600,
    height: 1066,
    caption: "Embroidered details of chapter regalia.",
  },
];
export const images = {
  lodge: "/images/placeholders/chapter-gathering-01.webp",
  officers: "/images/placeholders/chapter-gathering-wide.webp",
  line: "/images/placeholders/chapter-gathering-02.webp",
  crest: "/images/placeholders/chapter-detail.webp",
};
export type StorySection = { id: string; title: string; paragraphs: string[]; photoIndex?: number };
export type EventItem = {
  slug: string;
  title: string;
  iso: string;
  time: string;
  place: string;
  state: "planned" | "completed";
  termId: string;
  host: string;
  lead: string;
  summary: string;
  photoIndices: number[];
  sections: StorySection[];
};
export const events: EventItem[] = [
  {
    slug: "community-care-day",
    title: "Community Care Day",
    iso: "2025-11-23",
    time: "8:00 AM",
    place: "community venue, Naga City",
    state: "completed",
    termId: "2025-B",
    host: "Service Committee",
    lead: "Adrian Mercado · project lead",
    summary: "A day of practical service, shared responsibilities and thoughtful community care.",
    photoIndices: [0, 1, 2, 3, 4, 5],
    sections: [
      {
        id: "purpose",
        title: "A small act, carefully prepared",
        paragraphs: [
          "The chapter organized a community care day to practise service through practical work. Members prepared care packs, arranged a welcoming activity space and worked in small teams.",
          "The purpose was simple: build the habit of noticing what others need and following through. Careful preparation helped members connect each task with that shared purpose.",
        ],
        photoIndex: 1,
      },
      {
        id: "the-day",
        title: "Showing up together",
        paragraphs: [
          "The programme began with a volunteer briefing. One team handled materials, another helped with distribution, and a third kept the venue organized. Advisors offered guidance while members took responsibility for their assigned work.",
          "A short reflection closed the day. Volunteers discussed what went smoothly and what could be improved, including clearer packing labels and more time for preparation.",
        ],
        photoIndex: 2,
      },
      {
        id: "reflection",
        title: "What the next team can learn",
        paragraphs: [
          "The project stayed within its proposed allocation. Its expense record separates supplies, transport and refreshments so the next organizing team can understand where resources went.",
          "The team’s next steps are to improve packing labels, confirm transport early and allow more time for preparation.",
        ],
      },
    ],
  },
  {
    slug: "youth-leadership-workshop",
    title: "Youth Leadership Workshop",
    iso: "2026-05-17",
    time: "9:00 AM",
    place: "learning venue, Naga City",
    state: "completed",
    termId: "2026-A",
    host: "Leadership Committee",
    lead: "Rafael Santos · project lead",
    summary:
      "A workshop about listening well, planning clearly and leading through everyday decisions.",
    photoIndices: [1, 0, 3, 2, 5, 4],
    sections: [
      {
        id: "purpose",
        title: "Leadership starts with listening",
        paragraphs: [
          "The workshop gave members space to practise planning a small project together. Instead of beginning with a long lecture, the programme used short discussions and group exercises.",
          "Participants worked through familiar situations: dividing tasks fairly, responding when someone needs help, and explaining a decision to a team. The emphasis was on considerate, dependable leadership.",
        ],
        photoIndex: 1,
      },
      {
        id: "practice",
        title: "From an idea to a workable plan",
        paragraphs: [
          "Each team developed a project outline with an objective, a list of resources and a simple budget. They then compared plans and offered practical feedback.",
          "The organizing team recorded an unexpected materials cost. The final expense report shows the overspend alongside the original allocation, making the difference clear.",
        ],
        photoIndex: 2,
      },
      {
        id: "reflection",
        title: "Recording the lesson, including the cost",
        paragraphs: [
          "The report recommends checking supplier prices before approving a final activity budget. Proposed and actual costs remain visible together in the financial report.",
          "Future organizing teams can use these records to build in more preparation time, compare quotations and review the resources needed for each exercise.",
        ],
      },
    ],
  },
  {
    slug: "brotherhood-benefit-night",
    title: "Brotherhood Benefit Night",
    iso: "2026-11-15",
    time: "5:00 PM",
    place: "fellowship venue, Naga City",
    state: "planned",
    termId: "2026-B",
    host: "Fundraising Committee",
    lead: "Miguel Rivera · project lead",
    summary: "An upcoming evening of fellowship supporting the term’s service activities.",
    photoIndices: [0, 3, 1, 5, 2, 4],
    sections: [
      {
        id: "purpose",
        title: "An evening with a shared purpose",
        paragraphs: [
          "The upcoming activity is planned as a fellowship evening with a fundraising purpose. Its proposed programme brings members, families and supporters together around the term’s service plans.",
          "The programme will include time for conversation, a presentation of service priorities and opportunities for supporters to learn about the chapter’s work.",
        ],
        photoIndex: 1,
      },
      {
        id: "preparation",
        title: "Preparation before the evening",
        paragraphs: [
          "The committee plans to coordinate the venue, prepare printed materials and assign hosting responsibilities. Preparation expenses already incurred appear separately in the financial report.",
          "Fundraising targets are forecasts, not received cash. Income is recorded when received, with organizing costs shown separately.",
        ],
        photoIndex: 2,
      },
      {
        id: "next",
        title: "After the evening",
        paragraphs: [
          "After the evening, the organizing team will prepare a narrative report and reconcile income and expenses.",
          "Members can contact the chapter for programme updates and participation arrangements.",
        ],
      },
    ],
  },
  {
    slug: "community-reading-day",
    title: "Community Reading Day",
    iso: "2026-12-06",
    time: "9:00 AM",
    place: "reading venue, Naga City",
    state: "planned",
    termId: "2026-B",
    host: "Community Committee",
    lead: "Daniel Cruz · project lead",
    summary:
      "An upcoming service activity built around reading, encouragement and shared learning.",
    photoIndices: [1, 2, 0, 4, 3, 5],
    sections: [
      {
        id: "purpose",
        title: "Making room for a good story",
        paragraphs: [
          "The plan is for a welcoming reading day where volunteers help arrange books, facilitate short activities and encourage a love of learning.",
          "The focus will be on patient encouragement and making reading enjoyable. The team is preparing the programme before confirming the final arrangements.",
        ],
        photoIndex: 1,
      },
      {
        id: "programme",
        title: "A programme to prepare together",
        paragraphs: [
          "The organizing team intends to choose age-appropriate reading materials and prepare a simple volunteer briefing. Responsibilities will be confirmed during the preparation briefing.",
          "Volunteers will work together to arrange the reading space, guide small-group activities and make time for shared reflection.",
        ],
        photoIndex: 2,
      },
      {
        id: "next",
        title: "Details still to be confirmed",
        paragraphs: [
          "The chapter will confirm the venue and participation arrangements as preparation progresses. Contact the chapter for the latest programme updates.",
        ],
      },
    ],
  },
];
export type Article = {
  slug: string;
  title: string;
  date: string;
  kicker: string;
  excerpt: string;
  image: string;
  body: string[];
};
export const articles: Article[] = [
  {
    slug: "constitution-day",
    title: "A Chapter, Built Together",
    date: "2026-09-01",
    kicker: "Reflection",
    image: images.officers,
    excerpt: "The everyday work of building a welcoming chapter.",
    body: [
      "A chapter takes shape through small responsibilities: welcoming someone new, preparing a meeting space and keeping a promise to a teammate. These small actions build the trust that makes a chapter feel like a community.",
      "Tradition becomes meaningful when it is practised with care. Members can learn from one another while taking on tasks that fit their experience and asking for guidance when they need it.",
      "The strongest chapter culture grows through repeated acts of care. Each member has a part in making that culture welcoming and dependable.",
    ],
  },
  {
    slug: "seven-cardinal-virtues",
    title: "Values in Everyday Life",
    date: "2026-09-08",
    kicker: "Reflection",
    image: images.crest,
    excerpt: "Putting shared values into ordinary actions.",
    body: [
      "Courtesy can be as simple as listening without interrupting. Fidelity can mean doing the task you agreed to do. Values become habits through these everyday choices.",
      "A service project gives a team room to practise these habits together. Planning clearly, sharing credit and treating others with respect matter as much as the finished activity.",
      "Practising a value does not require a grand occasion. A thoughtful word, an honest answer or a promise kept gives it meaning in everyday life.",
    ],
  },
  {
    slug: "inside-the-lodge-room",
    title: "Before Everyone Arrives",
    date: "2026-09-15",
    kicker: "Chapter life",
    image: images.line,
    excerpt: "Preparation, teamwork and the care behind a gathering.",
    body: [
      "Before a gathering begins, someone checks the chairs, prepares the materials and makes room for guests. That often unseen preparation helps everyone feel welcome.",
      "Sharing these tasks helps members learn to depend on one another. An experienced member can explain a task while a newer member practises taking responsibility.",
      "Taking care of the details is one way to serve the whole group. When the work is shared, preparation becomes an opportunity to learn together.",
    ],
  },
  {
    slug: "on-service",
    title: "Service, Thoughtfully Recorded",
    date: "2026-09-22",
    kicker: "Civic work",
    image: images.officers,
    excerpt: "Connecting a project’s purpose with its report.",
    body: [
      "A useful project report explains what a team intended, what happened and what it learned. It gives the next team a practical starting point.",
      "Financial records belong alongside that story. Showing proposed costs and actual expenses helps supporters understand how resources were used.",
      "Keeping the narrative and financial report connected makes the lessons easier to carry forward. The next team can see both the purpose of the work and the resources it required.",
    ],
  },
];
export const virtues = [
  { n: "I", name: "Filial Love", text: "Care and gratitude toward parents and family." },
  {
    n: "II",
    name: "Reverence for Sacred Things",
    text: "Respect for faith and for what others hold sacred.",
  },
  { n: "III", name: "Courtesy", text: "Treating others with dignity in words and actions." },
  { n: "IV", name: "Comradeship", text: "Being a dependable friend and teammate." },
  { n: "V", name: "Fidelity", text: "Keeping promises and remaining worthy of trust." },
  { n: "VI", name: "Cleanness", text: "Care in thought, word and daily habits." },
  { n: "VII", name: "Patriotism", text: "Responsible service to country and community." },
];
export type TimelineEntry = {
  year: string;
  label: string;
  title: string;
  snippet: string;
  body: string[];
};
export const historyTimeline: TimelineEntry[] = [
  {
    year: "1314",
    label: "The namesake",
    title: "A name associated with fidelity",
    snippet:
      "Jacques de Molay, the last Grand Master of the Knights Templar, dies in Paris. His story later inspires the young founders of DeMolay.",
    body: [],
  },
  {
    year: "1919",
    label: "Kansas City",
    title: "Nine young men and a mentor",
    snippet:
      "Frank S. Land meets Louis Lower and helps him and eight friends form a club at the Scottish Rite Temple.",
    body: [],
  },
  {
    year: "1919",
    label: "March 24",
    title: "A new organization takes shape",
    snippet:
      "The early group organizes as DeMolay. The lecture distinguishes this meeting from the later March 18 observance associated with its namesake.",
    body: [],
  },
  {
    year: "1959",
    label: "A lasting influence",
    title: "Remembering Dad Land",
    snippet:
      "Land dies on November 8, leaving an organization built around mentorship, responsibility and service.",
    body: [],
  },
];
export const historyIntro = [
  "Frank Sherman Land founded the Order of DeMolay in Kansas City, Missouri, in 1919. His friendship with Louis Lower and eight other young men became the beginning of an organization built around guidance, responsibility and fellowship.",
  "The young men chose a name inspired by Jacques de Molay, the last Grand Master of the Knights Templar. Within DeMolay’s tradition, his story represents fidelity and courage. The twentieth-century youth organization is distinct from the medieval order.",
];
export const historySources = [
  { title: "Petitioner lecture, pages 5–14 (chapter-supplied source)", url: null },
  {
    title: "Scottish Rite Masonic Museum & Library · The Order of DeMolay",
    url: "https://www.srmml.org/exhibitions/the-order-of-demolay/",
  },
  { title: "Pennsylvania DeMolay · Our History", url: "https://pademolay.org/history/" },
];
export const historicalPhotos = [
  {
    src: "/images/history/jacques-de-molay.webp",
    alt: "Nineteenth-century illustration depicting Jacques de Molay",
    width: 1200,
    height: 1870,
    caption:
      "Jacques de Molay · Unknown artist, 19th century · Bibliothèque nationale de France / Wikimedia Commons · Public domain",
    source: "https://commons.wikimedia.org/wiki/File:JacquesdeMolay.jpg",
    license: "https://creativecommons.org/publicdomain/mark/1.0/",
  },
  {
    src: "/images/history/frank-land-bust.webp",
    alt: "Bust of Frank S. Land at the Philippine DeMolay Youth Center",
    width: 1600,
    height: 1200,
    caption: "Frank S. Land bust · Photograph by Judgefloro, 2016 · Wikimedia Commons · CC0",
    source:
      "https://commons.wikimedia.org/wiki/File:Bust_of_Frank_S._Land_(Philippine_DeMolay_Youth_Center).jpg",
    license: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
];
export type Term = {
  id: string;
  year: number;
  half: "A" | "B";
  opening: number;
  proposedSponsors: number;
  proposedFundraising: number;
};
export type Income = {
  id: string;
  termId: string;
  date: string;
  kind: "sponsor" | "fundraising";
  description: string;
  amount: number;
};
export type Expense = {
  id: string;
  projectId: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  responsible: string;
};
export type Project = {
  id: string;
  title: string;
  eventSlug: string;
  termId: string;
  proposed: number | null;
  notes: string;
  responsible: string;
};
export const terms: Term[] = [
  {
    id: "2025-B",
    year: 2025,
    half: "B",
    opening: 1000000,
    proposedSponsors: 1500000,
    proposedFundraising: 500000,
  },
  {
    id: "2026-A",
    year: 2026,
    half: "A",
    opening: 1850000,
    proposedSponsors: 1500000,
    proposedFundraising: 800000,
  },
  {
    id: "2026-B",
    year: 2026,
    half: "B",
    opening: 2570000,
    proposedSponsors: 1200000,
    proposedFundraising: 1800000,
  },
];
export const income: Income[] = [
  {
    id: "income-1",
    termId: "2025-B",
    date: "2025-10-01",
    kind: "sponsor",
    description: "community sponsor contribution",
    amount: 1200000,
  },
  {
    id: "income-2",
    termId: "2025-B",
    date: "2025-11-01",
    kind: "fundraising",
    description: "merchandise fundraiser · gross receipts",
    amount: 450000,
  },
  {
    id: "income-3",
    termId: "2026-A",
    date: "2026-02-02",
    kind: "sponsor",
    description: "workshop sponsor contribution",
    amount: 1400000,
  },
  {
    id: "income-4",
    termId: "2026-A",
    date: "2026-03-01",
    kind: "fundraising",
    description: "fundraising receipts · gross",
    amount: 600000,
  },
  {
    id: "income-5",
    termId: "2026-B",
    date: "2026-08-20",
    kind: "sponsor",
    description: "service programme contribution",
    amount: 800000,
  },
  {
    id: "income-6",
    termId: "2026-B",
    date: "2026-09-20",
    kind: "fundraising",
    description: "merchandise receipts · gross",
    amount: 300000,
  },
];
export const projects: Project[] = [
  {
    id: "community-care",
    title: "Community Care Day",
    eventSlug: "community-care-day",
    termId: "2025-B",
    proposed: 1000000,
    notes: "Completed project; unused allocation remains in chapter cash.",
    responsible: "Adrian Mercado · project lead",
  },
  {
    id: "fundraiser-2025",
    title: "Supporting merchandise fundraiser",
    eventSlug: "community-care-day",
    termId: "2025-B",
    proposed: 100000,
    notes: "Term fundraiser supporting the project; costs are separate from gross income.",
    responsible: "Elena Reyes · treasurer",
  },
  {
    id: "leadership-workshop",
    title: "Youth Leadership Workshop",
    eventSlug: "youth-leadership-workshop",
    termId: "2026-A",
    proposed: 1000000,
    notes: "Additional materials caused this project to exceed its original allocation.",
    responsible: "Rafael Santos · project lead",
  },
  {
    id: "fundraiser-2026-a",
    title: "Supporting term fundraiser",
    eventSlug: "youth-leadership-workshop",
    termId: "2026-A",
    proposed: 100000,
    notes: "Fundraising costs shown separately from gross receipts.",
    responsible: "Elena Reyes · treasurer",
  },
  {
    id: "benefit-night",
    title: "Brotherhood Benefit Night",
    eventSlug: "brotherhood-benefit-night",
    termId: "2026-B",
    proposed: 1200000,
    notes:
      "Only preparation costs incurred by October 15 are recorded. The evening has not taken place.",
    responsible: "Miguel Rivera · project lead",
  },
  {
    id: "fundraiser-2026-b",
    title: "Separate merchandise fundraiser",
    eventSlug: "brotherhood-benefit-night",
    termId: "2026-B",
    proposed: 100000,
    notes: "Separate merchandise costs; not benefit-night receipts.",
    responsible: "Elena Reyes · treasurer",
  },
];
export const expenses: Expense[] = [
  {
    id: "expense-1",
    projectId: "community-care",
    date: "2025-11-21",
    category: "Materials",
    description: "care-pack supplies",
    amount: 500000,
    responsible: "Adrian Mercado · project lead",
  },
  {
    id: "expense-2",
    projectId: "community-care",
    date: "2025-11-23",
    category: "Transport",
    description: "materials transport",
    amount: 150000,
    responsible: "Adrian Mercado · project lead",
  },
  {
    id: "expense-3",
    projectId: "community-care",
    date: "2025-11-23",
    category: "Refreshments",
    description: "volunteer refreshments",
    amount: 100000,
    responsible: "Adrian Mercado · project lead",
  },
  {
    id: "expense-4",
    projectId: "fundraiser-2025",
    date: "2025-10-25",
    category: "Fundraising costs",
    description: "merchandise materials",
    amount: 50000,
    responsible: "Elena Reyes · treasurer",
  },
  {
    id: "expense-5",
    projectId: "leadership-workshop",
    date: "2026-05-15",
    category: "Materials",
    description: "workshop materials and additional supplies",
    amount: 650000,
    responsible: "Rafael Santos · project lead",
  },
  {
    id: "expense-6",
    projectId: "leadership-workshop",
    date: "2026-05-17",
    category: "Venue",
    description: "learning-space rental",
    amount: 400000,
    responsible: "Rafael Santos · project lead",
  },
  {
    id: "expense-7",
    projectId: "leadership-workshop",
    date: "2026-05-17",
    category: "Refreshments",
    description: "participant refreshments",
    amount: 150000,
    responsible: "Rafael Santos · project lead",
  },
  {
    id: "expense-8",
    projectId: "fundraiser-2026-a",
    date: "2026-02-20",
    category: "Fundraising costs",
    description: "fundraiser materials",
    amount: 80000,
    responsible: "Elena Reyes · treasurer",
  },
  {
    id: "expense-9",
    projectId: "benefit-night",
    date: "2026-10-01",
    category: "Preparation",
    description: "venue reservation deposit",
    amount: 200000,
    responsible: "Miguel Rivera · project lead",
  },
  {
    id: "expense-10",
    projectId: "benefit-night",
    date: "2026-10-10",
    category: "Preparation",
    description: "programme printing",
    amount: 50000,
    responsible: "Miguel Rivera · project lead",
  },
  {
    id: "expense-11",
    projectId: "fundraiser-2026-b",
    date: "2026-09-01",
    category: "Fundraising costs",
    description: "merchandise production",
    amount: 60000,
    responsible: "Elena Reyes · treasurer",
  },
];
export const leaders = [
  {
    name: "Adrian Mercado",
    termId: "2025-B",
    eventSlug: "community-care-day",
    summary:
      "The term focused on dependable volunteer teams and practical community service. Its report records a completed care day, a fundraising activity and an orderly cash carryover.",
    lesson:
      "Prepare materials early and keep the project narrative together with its expense records.",
    photoIndices: [0, 1, 2],
  },
  {
    name: "Rafael Santos",
    termId: "2026-A",
    eventSlug: "youth-leadership-workshop",
    summary:
      "The term emphasized listening, shared planning and leadership practice. Its workshop exceeded its allocation; the report keeps that variance visible as a lesson for future organizers.",
    lesson: "Confirm supplier prices before setting the final project allocation.",
    photoIndices: [1, 3, 4],
  },
];
