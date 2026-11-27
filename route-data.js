/* ===== The Route — the site, and everything that happened on it =====
   The section is a site plan. The road enters bottom left at Mumbai, runs
   past the education precinct, turns down through the works, and ends at an
   empty lot. Nothing from the old process flow is dropped: the same nine
   entries are here, with the two degrees now standing in a campus of their
   own rather than hanging off the line as nodes.

   The plan is laid out by place, not strictly by date — education to the
   left, the jobs to the right — so each board carries its own years. Among
   the jobs the order still runs left to right, because that is the order
   they happened in.

   Position is given along the road, not in pixels. `t` is distance down the
   road from its head, measured along the zig-zag the renderer lays out;
   `side` is which verge a structure stands on, -1 for the far side and 1
   for the near; `off` is how far back from the kerb.

   @typedef {Object} Site
   @property {string} id
   @property {'plot'|'hall'|'unit'|'works'|'vacant'} kind
   @property {number} t
   @property {-1|1} side
   @property {number} off
   @property {number} w     - footprint along the road
   @property {number} d     - footprint across it
   @property {number} h     - height
   @property {string} name
   @property {string} [sub] - the place it stands in
   @property {string} when
   @property {string} [note]
   @property {boolean} [live]
*/
(function (root) {
  "use strict";

  root.ROUTE = {
    labels: {
      plan: "Site plan · isometric · not to scale",
      key: "Experience",
      education: "Education",
      legend: "Mumbai, then the campus, then the works"
    },

    /* the years, painted flat on the road between structures */
    marks: [
      { at: 52, label: "2019" },
      { at: 118, label: "2022" },
      { at: 186, label: "2024" },
      { at: 244, label: "Now" }
    ],

    /* the education precinct: one campus holding both degrees, with its own
       boundary, a quad, a drive off the road and a gate board */
    precinct: {
      label: "Education", when: "2019 \u2013 2024",
      t0: 10, t1: 82, side: -1, off0: 8, off1: 62,
      quad: { t0: 42, t1: 54, off0: 16, off1: 38 },
      gate: { t: 48, off: 10, side: 1 },
      blocks: [
        { t: 30, off: 40, w: 15, d: 9, h: 6 },
        { t: 66, off: 40, w: 15, d: 9, h: 6 }
      ],
      trees: [[40, 13], [56, 13], [40, 41], [56, 41], [48, 13]]
    },

    /* the working half of the site, with its own gate board */
    works: { label: "Experience", when: "2021 \u2013 now", at: 206, off: 26, side: 1 },

    /* The Experience list, and the order it is read in. It is given by hand
       rather than derived from the dates, because the list is a shortlist:
       it names the work worth leading with, in the order it should be met.
       Everything on the plan stays on the plan; a job that is not on this
       list simply goes unnumbered, the way Mumbai and the two schools do.
       The numbers follow this order, so 01 is whatever stands first here. */
    roster: ["amat", "jio", "webxpress", "nyu"],

    /* Unnamed buildings. The site is a place, not a row of exhibits, and a
       plan with nothing between its labelled parts reads as a diagram of
       nine things rather than somewhere that was lived in. None of these
       stand for anything; they are the rest of the estate. */
    scenery: [
      { t: 24, side: -1, off: 54, w: 16, d: 10, h: 5 },
      { t: 46, side: -1, off: 54, w: 12, d: 9, h: 8 },
      { t: 68, side: -1, off: 54, w: 16, d: 10, h: 5 },
      { t: 30, side: 1, off: 20, w: 14, d: 10, h: 5 },
      { t: 52, side: 1, off: 22, w: 12, d: 9, h: 7 },
      { t: 72, side: 1, off: 18, w: 10, d: 8, h: 4 },
      { t: 112, side: -1, off: 18, w: 12, d: 9, h: 6 },
      { t: 136, side: -1, off: 20, w: 14, d: 10, h: 5 },
      { t: 102, side: 1, off: 36, w: 14, d: 10, h: 5 },
      { t: 132, side: 1, off: 36, w: 12, d: 9, h: 7 },
      { t: 164, side: -1, off: 44, w: 16, d: 10, h: 5 },
      { t: 192, side: -1, off: 46, w: 14, d: 10, h: 8 },
      { t: 222, side: -1, off: 46, w: 18, d: 11, h: 6 },
      { t: 166, side: 1, off: 32, w: 14, d: 10, h: 5 },
      { t: 182, side: 1, off: 34, w: 12, d: 9, h: 6 },
      { t: 232, side: 1, off: 32, w: 16, d: 10, h: 5 }
    ],

    /** @type {Site[]} */
    sites: [
      { id: "mumbai", kind: "plot", t: 8, side: 1, off: 14, w: 12, d: 10, h: 6,
        name: "Mumbai", sub: "India", when: "Until 2019",
        note: "Where it starts" },

      { id: "iitgoa", kind: "hall", t: 30, side: -1, off: 26, w: 22, d: 14, h: 11,
        name: "IIT Goa", sub: "Goa, India", when: "2019 – 2023",
        note: "B.Tech, Mechanical Engineering" },
      { id: "cornell", kind: "hall", t: 66, side: -1, off: 26, w: 22, d: 14, h: 11,
        name: "Cornell", sub: "Ithaca, NY", when: "2023 – 2024",
        note: "M.Eng, Engineering and Industrial Management" },

      { id: "nyu", kind: "unit", t: 96, side: 1, off: 16, w: 13, d: 11, h: 7,
        name: "NYU IRES", when: "2021", note: "Additive manufacturing security" },
      { id: "jio", kind: "unit", t: 118, side: 1, off: 16, w: 13, d: 11, h: 7,
        name: "Jio AI CoE", when: "2022", note: "Refinery digital twin" },
      { id: "webxpress", kind: "unit", t: 140, side: 1, off: 16, w: 13, d: 11, h: 7,
        name: "WebXpress AI", when: "2023", note: "Fleet carbon tracking" },

      { id: "ithaca", kind: "unit", t: 166, side: -1, off: 17, w: 14, d: 11, h: 7,
        name: "Town of Ithaca", when: "2024", note: "Fleet replacement policy" },
      { id: "refund", kind: "unit", t: 188, side: -1, off: 17, w: 14, d: 11, h: 7,
        name: "Refund Clarity", when: "2024", note: "Early-stage product" },

      { id: "amat", kind: "works", t: 212, side: -1, off: 19, w: 26, d: 16, h: 12,
        name: "Applied Materials", sub: "Santa Clara, CA", when: "2024 – now",
        note: "Robotic platform for fab service", live: true },

      { id: "next", kind: "vacant", t: 236, side: -1, off: 17, w: 15, d: 11, h: 0,
        name: "Next", when: "Loading", note: "The lot is kept clear" }
    ],

    /* `site` is the hall on the plan that each degree was earned in, so a
       row here can light up its own building the way a job row does. */
    education: [
      { site: "iitgoa",
        org: "Indian Institute of Technology, Goa", deg: "B.Tech, Mechanical Engineering",
        loc: "Goa, India", when: "2019 – 2023", note: "Institute Bronze Medalist" },
      { site: "cornell",
        org: "Cornell University", deg: "M.Eng, Engineering and Industrial Management",
        loc: "Ithaca, NY", when: "2023 – 2024", note: "Degree Marshal, first across the M.Eng programs" }
    ]
  };
})(window);
