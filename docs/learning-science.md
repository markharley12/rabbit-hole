# Learning science: what the app does, and what it rests on

Short on purpose. Each technique below says what the app does, then a source that was opened
while writing this (16 Nov 2026) and the one thing it supports. Sources were opened through
Europe PMC's and Crossref's record APIs (the publishers' own pages and PubMed served cookie
walls); only the records were read, not the full papers, so each claim is limited to what
the record states. Nothing here is cited that was not opened.

## Spacing (distributed practice)

**In the app:** an item answered right comes back after growing gaps: 1, 3, 7, 16, 35, 90 days
(`src/review/schedule.ts`).

- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., and Rohrer, D. (2006). Distributed practice
  in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin*, 132(3),
  354-380. DOI 10.1037/0033-2909.132.3.354. Opened 16 Nov 2026:
  https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:16719566%20AND%20SRC:MED&format=json&resultType=core.
  Supports: the gap between study sessions that gives the best retention gets longer as the
  time until the final test gets longer, which is the reason for gaps that grow.
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., and Willingham, D. T. (2013).
  Improving students' learning with effective learning techniques. *Psychological Science in the
  Public Interest*, 14(1), 4-58. DOI 10.1177/1529100612453266. Opened 16 Nov 2026:
  https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:26173288%20AND%20SRC:MED&format=json&resultType=core.
  Supports: of ten techniques reviewed, distributed practice and practice testing were rated
  highest in utility; rereading and highlighting were rated low.

## Retrieval practice

**In the app:** a review item is answered again from scratch (a typed answer for a step; the
formula written on paper before it is shown), never re-read.

- Roediger, H. L., and Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests
  improves long-term retention. *Psychological Science*, 17(3), 249-255. DOI
  10.1111/j.1467-9280.2006.01693.x. Opened 16 Nov 2026:
  https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:16507066%20AND%20SRC:MED&format=json&resultType=core.
  Supports: testing is a means of improving learning, not only of assessing it.
- Dunlosky et al. (2013), above, for practice testing.

## Interleaving

**In the app:** a session is at most ten items, oldest due first, arranged so two items from one
lesson are not side by side when that can be avoided.

- Rohrer, D., and Taylor, K. (2007). The shuffling of mathematics problems improves learning.
  *Instructional Science*, 35(6), 481-498. DOI 10.1007/s11251-007-9015-8. Opened 16 Nov 2026:
  https://api.crossref.org/works/10.1007/s11251-007-9015-8. Supports: the title's claim, that
  shuffled maths problems improve learning; the record had no abstract, so the size and
  conditions of the effect were not read.

## Immediate, specific feedback

**In the app:** an answer is checked on the spot and a known slip is named ("looks like you
transposed"), not just marked wrong.

- Hattie, J., and Timperley, H. (2007). The power of feedback. *Review of Educational Research*,
  77(1), 81-112. DOI 10.3102/003465430298487. Opened 16 Nov 2026:
  https://api.crossref.org/works/10.3102/003465430298487. Supports: feedback is among the most
  influential factors in learning, but its effect can be positive or negative depending on its
  type and how it is given, so what kind of feedback is a design decision, not a given.

## Worked steps with hints

**In the app:** a lesson is steps, each with three graded hints (a nudge, a narrower nudge, a
worked fragment) and the answer only after the hints.

- Atkinson, R. K., Derry, S. J., Renkl, A., and Wortham, D. (2000). Learning from examples:
  Instructional principles from the worked examples research. *Review of Educational
  Research*, 70(2), 181-214. DOI 10.3102/00346543070002181. Opened 16 Nov 2026:
  https://api.crossref.org/works/10.3102/00346543070002181. Supports: worked examples are most
  associated with early skill development, and learners can be prompted to self-explain them.
  This supports worked examples; the specific three-hint ladder is the project's own design.

## Quiz and puzzle screens

**In the app:** a `choice` question and an `order` puzzle (course-authoring.md section 12) are answered on
the spot, and every option carries its own reason, so a wrong pick is told why that option is wrong. They
come back in review like steps. They exist because a typed number cannot test which statement is true, why
a step is valid, or the order of a proof.

- Roediger and Karpicke (2006) and Dunlosky et al. (2013), above: answering a question is itself a way to
  learn (practice testing), which is why these are scored questions and not text to read.
- Hattie and Timperley (2007), above: the kind of feedback matters, which is why each option has a specific
  `say` and an order puzzle marks one line only, not the whole answer.
- Not shown by any source opened here: that choosing or ordering teaches better than typing an answer. The
  reason for the formats is what they can test, a design choice. The thresholds for "Show the answer" (two
  wrong tries for a question, three for a puzzle) are comfort choices.

## What is not evidence-based in the design

- **The ladder numbers (1, 3, 7, 16, 35, 90) are a convention, not an optimum.** The evidence
  above says gaps should grow with the time you want to remember for; it does not give these
  numbers.
- The rule "a miss drops two rungs" and the grades (right first try and no hint, right but
  after a wrong try or a hint, answer shown) are choices made for simplicity.
- The cap of ten items a session is a comfort limit, not a research finding.
- A review step is answered with the same numbers each time, so a learner can remember the
  answer rather than reproduce the method.
- Whether the Review button's badge motivates or pressures is not known.

## Candidates, not yet used

- Changing the numbers on each repeat (parametrised steps), so recall is of the method.
- Self-explanation prompts ("why does this step work?") in review and in lessons.
- Fading worked steps as skill grows, instead of one fixed hint ladder.
- Asking for a confidence guess before an answer is revealed, to calibrate.
- Adjusting each item's gaps from the learner's own history, rather than one ladder for all.
