/* ===== Selected Work — content =====
   The one place the Selected Work entries live. Nothing here is referenced by
   layout: the section reads this file and nothing else, so an entry can be
   written, reordered or retired without opening svara.js or svara.css.

   This is the shortlist, not the whole record. The full set of six
   professional entries is on the Work sheet behind "See all work"; the four
   below are the ones the home sheet leads with, and they are numbered in the
   order they stand here.

   The project has no build step, so the shape below is carried as JSDoc rather
   than TypeScript. Editors and `tsc --checkJs` read it the same way.

   @typedef {Object} Metric
   @property {string} value       - the figure as it is printed, "$15M+"
   @property {string} label       - what the figure counts
   @property {string} derivation  - how it was arrived at, behind the circled i

   @typedef {Object} EntryLink
   @property {string} label
   @property {string} url

   @typedef {Object} Entry
   @property {string} id
   @property {'professional'|'builds'} group
   @property {string} date        - "JUL 2024", the closed row's left column
   @property {string} summary     - 5 to 8 words, the whole of the closed row
   @property {string} title
   @property {string} org
   @property {string} industry
   @property {string} tag         - equipment tag, "RC-101"
   @property {string} period      - "Jul 2024 – present"
   @property {EntryLink} [link]
   @property {'coming-soon'} [status]
   @property {Metric[]} metrics   - 2, or 0 when status is coming-soon
   @property {string} problem
   @property {string} [brief]     - omitted entirely when there was no brief
   @property {string} did
   @property {string[]} outcome   - short fragments, one per line
   @property {string[]} skills
*/
(function (root) {
  "use strict";

  /* the two groups, in the order they are drawn, with the label each one
     carries on the sheet */
  var WORK_GROUPS = [
    { id: "professional", label: "Professional" },
    { id: "builds", label: "Builds & Prototypes" }
  ];

  /* every label the section prints that is not part of an entry */
  var WORK_LABELS = {
    problem: "Problem",
    brief: "Brief",
    did: "What I did",
    outcome: "Highlights",
    comingSoon: "In progress",
    cta: "Read the record",
    close: "Close",
    derivation: "How this figure was arrived at",
    panel: "Work detail"
  };

  /** @type {Entry[]} */
  var WORK_ENTRIES = [
    {
      id: "amat-robotic-platforms",
      group: "professional",
      date: "JUL 2024",
      summary: "First robotic platform for fab service",
      title: "Robotic platforms, 0 to 1",
      org: "Applied Materials",
      industry: "Semiconductor Robotics",
      tag: "RC-101",
      period: "Jul 2024 – present",
      metrics: [
        { value: "2", label: "Tier-1 pilots",
          derivation: "Running on tool with memory and logic customers." },
        { value: "3", label: "Platforms scoped",
          derivation: "Etch, polishing and deposition tools." }
      ],
      problem: "Demand for memory and AI chips is surging. Fabs need more service uptime than their teams can supply.",
      brief: "Take a high mix, low volume robotic platform from scope to deployment across etch, polishing and deposition tools.",
      did: "Defined the roadmap and capability stack, wrote the engineering requirements, and mapped the human and robot collaboration journey behind the operator interface. Owned the program proposal and the investment case that secured a Service Robotics Technologies Lab from the Singapore Government EDB.",
      outcome: [
        "$15M+ funding secured",
        "2 Tier-1 pilots, on tool with memory and logic customers",
        "Provisional patent on in-tool electrostatic chuck metrology"
      ],
      skills: ["Platform Scoping", "Requirements & Specs", "Human-Robot Interaction",
               "Roadmap & GTM", "Robot Simulation", "CAD", "Python", "Claude Skills"]
    },
    {
      id: "jio-refinery-twin",
      group: "professional",
      date: "JUN 2022",
      summary: "Test a change without touching the plant",
      title: "A digital twin of a crude distillation unit",
      org: "Jio Platforms, Reliance Industries",
      industry: "Industrial Data Science",
      tag: "DC-201",
      period: "Jun – Dec 2022",
      metrics: [
        { value: "92%", label: "Prediction accuracy",
          derivation: "Against live plant readings, up from 85%." },
        { value: "50+", label: "Sensors integrated",
          derivation: "Feeding the twin from across seven unit operations." }
      ],
      problem: "Operators could read every instrument on a distillation unit but could not test a change without risking live production.",
      brief: "Simulate the unit from live sensor data, accurately enough to guide operating decisions.",
      did: "Built DWSIM models for each unit operation and ran them across realistic conditions to generate the training data the neural networks needed, since you cannot run a real refinery off-spec to collect it.",
      outcome: [
        "Accuracy 85% to 92% against live plant readings",
        "Seven unit operations modelled and connected as one plant",
        "Sensor data consistency up 40% after moving the pipeline to Protocol Buffers"
      ],
      skills: ["Process Simulation", "Synthetic Data Generation", "Model Validation",
               "Digital Twin", "DWSIM", "Protocol Buffers", "Python", "Neural Networks"]
    },
    {
      id: "iitgoa-remaining-life",
      group: "professional",
      date: "JAN 2023",
      summary: "Remaining useful life, without a bigger model",
      title: "Estimating what’s left of a machine’s life",
      org: "IIT Goa",
      industry: "Reliability Engineering",
      tag: "BR-501",
      period: "Jan – Apr 2023",
      link: { label: "Springer chapter", url: "https://link.springer.com/chapter/10.1007/978-3-031-55048-5_11" },
      metrics: [
        { value: "35–40%", label: "Lower prediction error",
          derivation: "Beating traditional pipelines by a further 2 to 4%." },
        { value: "First author", label: "Peer-reviewed Springer chapter",
          derivation: "Turbofan engines, bearings and solar cells, all modelled." }
      ],
      problem: "Reactive maintenance catches failures only after they happen, risking equipment and sometimes lives.",
      did: "Built fault detection and remaining useful life models across three unrelated components, using particle swarm feature selection with custom objectives rather than reaching for larger models.",
      outcome: [
        "Prediction error cut 35–40%, beating traditional pipelines by 2 to 4%",
        "Turbofan engines, bearings and solar cells all modelled",
        "First author, peer-reviewed Springer chapter"
      ],
      skills: ["Predictive Maintenance", "Machine Learning", "Feature Engineering",
               "Technical Writing", "Particle Swarm Optimization", "Python"]
    },
    {
      id: "nyu-gcode-tampering",
      group: "professional",
      date: "JUN 2021",
      summary: "Catching tampered G-code without the original",
      title: "Detecting tampered G-code",
      org: "NYU IRES",
      industry: "Additive Manufacturing",
      tag: "AM-601",
      period: "Jun – Aug 2021",
      link: { label: "arXiv · IEEE Embedded Systems Letters", url: "https://arxiv.org/abs/2111.12746" },
      metrics: [
        { value: "~83%", label: "Attack detection coverage",
          derivation: "Across six attack methods, tested blind." },
        { value: "4,000+", label: "Control files",
          derivation: "More manufacturing control files than anyone can inspect by hand." }
      ],
      problem: "G-code is an intermediate machine format, so malicious edits are nearly invisible when the manufacturer never sees the original CAD model.",
      brief: "Quantify whether subtle tampering in machine-level data can be detected at all, at a scale no one can inspect by hand.",
      did: "Built ML anomaly detection pipelines across 4,000+ manufacturing control files, benchmarked unsupervised against statistical methods, and analysed precision-recall and false-positive trade-offs to guide deployment decisions.",
      outcome: [
        "~83% attack detection coverage",
        "Published in IEEE Embedded Systems Letters, 2022",
        "NSF funded through NYU’s International Research Experience for Students",
        "2nd place, Hack3D"
      ],
      skills: ["Anomaly Detection", "Machine Learning", "Research & Publication",
               "Manufacturing Security", "PCA", "Python"]
    },

    /* Two reserved sheets. A drawing set numbers the sheets it is going to
       issue before they are drawn, and this group is held open the same way:
       the slot is on the sheet, the record goes in when there is one. Give
       either of these a title, a tag and its figures and it stops being a
       placeholder with no other change. */
    {
      id: "build-reserved-1",
      group: "builds",
      date: "SOON",
      summary: "Reserved for the next build",
      title: "Loading",
      org: "Personal",
      industry: "Prototype",
      tag: "TBD",
      period: "In progress",
      status: "coming-soon",
      metrics: [],
      problem: "Still being built.",
      did: "The record goes up when there is something worth reading.",
      outcome: ["To be issued"],
      skills: []
    },
    {
      id: "build-reserved-2",
      group: "builds",
      date: "SOON",
      summary: "Reserved for the next build",
      title: "Loading",
      org: "Personal",
      industry: "Prototype",
      tag: "TBD",
      period: "In progress",
      status: "coming-soon",
      metrics: [],
      problem: "Still being built.",
      did: "The record goes up when there is something worth reading.",
      outcome: ["To be issued"],
      skills: []
    }
  ];

  root.WORK_GROUPS = WORK_GROUPS;
  root.WORK_LABELS = WORK_LABELS;
  root.WORK_ENTRIES = WORK_ENTRIES;
})(window);
