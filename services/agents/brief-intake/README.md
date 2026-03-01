# brief-intake

## Purpose
`brief-intake` converts a natural-language project brief into a deterministic structured brief, then raises clarifying questions only for supervised or human-required decisions.

## Input Schema (`agent.json`)
- `brief` (string, required): natural-language project request.
- `userPreferences` (object, optional): extra deterministic hints for future extensions.

## Output Schema (`agent.json`)
- `structuredBrief`: `{ projectName, techStack, features, constraints, userStories }`
- `clarifyingQuestions`: ordered questions with:
  - `id`
  - `question`
  - `category` (`security` | `architecture` | `features` | `ux`)
  - `impact` (`high` | `medium` | `low`)
  - `defaultAssumption`
- `resolvedAssumptions`: defaults the agent is using until clarified.
- `scopeEstimate`: `{ sprintCountRange, complexityRating }`

## Autonomy Taxonomy
- Questions are generated only for supervised or human-required decisions.
- Full-autonomy decisions stay internal and are never surfaced.
- Question priority order is fixed: `security` > `architecture` > `features` > `ux`.

## Parsing Heuristics
- Tech stack is inferred from keyword matching (`Next.js`, `React`, `Flask`, `Express`, `PostgreSQL`, `NextAuth`, `Stripe`, etc.).
- Features are extracted from deterministic phrase matching, with explicit handling for CRUD phrasing.
- Constraints are extracted from explicit negative phrases such as `no payment processing`.
- User stories are derived from features using `As a user, I want to ...`.

## Scope Estimation
- `1-3` features: `sprintCountRange = [1, 2]`
- `4-7` features: `sprintCountRange = [2, 4]`
- `8+` features: `sprintCountRange = [4, 8]`
- Complexity rises with feature count plus integration signals like database, auth, and payments.

## Safety Constraints
- No LLM calls, no network access, no randomness.
- Identical input produces identical output.
- Output is validated against `@acme/contracts` before returning success.

## Usage
```bash
pnpm af agent:run brief-intake --input '{"brief":"Build a Next.js web app with PostgreSQL database and NextAuth authentication where users can create, read, update, and delete todo items. Deploy to Vercel. Use Tailwind CSS for styling. No payment processing needed."}' --validate-input
```
