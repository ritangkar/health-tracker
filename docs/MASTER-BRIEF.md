# Winter Arc: master brief

This is the original project brief, kept as the reference every agent worked from. The only change from the original text is one example sentence in the section "No fixed weekday rule": the original named two days of the week as an example of a forbidden mapping. The names are replaced by plain words so that the repository-wide check for day-of-week words stays clean. Meaning is unchanged.

## Project

Winter Arc: a private personal health, fitness, nutrition and progress-tracking web app for exactly two initial users (the owner and his wife). Adding more users later must be technically possible but must not add unnecessary V1 complexity.

## Principles

Local-first, privacy-first, free, no unnecessary infrastructure, simple to maintain, excellent UX, fast, mobile-friendly and desktop-friendly, offline-capable where practical, data ownership belongs to users, easy export/import, no vendor lock-in, no unnecessary framework complexity, no unnecessary backend, no overengineering. Intended for long-term personal use. The most important thing is that historical data remains accessible.

## Zero cost and deployment

The app must be free to build, free to deploy, hosted on GitHub Pages, persistent despite being a static site, with no paid backend, database or server to maintain and no recurring subscription. Flow: GitHub repository, then GitHub Pages, then open URL, then the app works. The user should NOT need to run a local server, install Node.js or Python, configure a database, Firebase, Supabase, AWS or any backend, pay for hosting, or manually start services. The app runs directly in the browser. Implementation agents must investigate and select the best zero-cost architecture. A dedicated zero-rupee consideration is required. Avoid paid APIs, databases, hosting, analytics, image storage, authentication, and runtime AI APIs. The architecture must identify all potential hidden costs. Development may use Claude/AI; the deployed app must not need paid AI. AI is not required at runtime; V1 must be fully functional without it (AI may be a future idea). The final deliverable must feel like a real modern application, polished and beautiful, not a basic personal page.

## Technology

Not predetermined. Evaluate vanilla HTML/CSS/JS, TypeScript, React, Vue, Svelte and other zero-cost frontend approaches on: GitHub Pages compatibility, maintainability, offline support, IndexedDB support, build complexity, performance, UI quality, long-term maintainability, and ability to produce a fully static deployment. Do not choose by popularity. The final stack must be justified.

## Persistence

GitHub Pages cannot be a database, so use browser-side local-first persistence. Candidates: IndexedDB, LocalStorage for small settings only, Cache APIs where appropriate, PWA storage, export/import JSON, Blob/binary storage for images. Do not assume LocalStorage is sufficient; the app must preserve substantial structured data and potentially progress images. Architecture agents determine the most robust approach.

## Backup and restore (critical)

Export all data into a portable backup, for example winter-arc-backup-YYYY-MM-DD.json, or an archive format if images require it. Export includes: users, goals, food database additions, custom foods, recipes, exercise library, workout plans, daily logs, food logs, exercise logs, step logs, water logs, sleep logs, measurements, progress check-ins, notes, settings, other user-generated data. Progress images need a robust backup strategy. Import must let the user restore a backup and must address: versioning, schema migrations, invalid/corrupted backup handling, duplicate handling, existing-data conflicts, backward compatibility.

## Two users

Two profiles (for example User 1, User 2). Each has independent: food logs, exercise logs, steps, water, sleep, measurements, progress photos, goals, notes, daily records. The app may include a shared/couple dashboard showing selected information. Do not assume every personal metric is shown to both users. Privacy should be considered in the UX.

## Nutrition logging

Daily logging of calories, protein, carbohydrates, fat, and fiber if supported by the food data. Food is logged by food item, serving, quantity, serving unit, and actual amount where appropriate. Meal grouping with suggested defaults: Breakfast, Lunch, Snacks, Dinner, Other. The user should be able to add/remove/customize meal categories if the architecture supports it without unnecessary complexity. Daily nutrition shows total calories, protein, carbs, fat, fiber, and a per-meal breakdown.

## Food database

An extensive initial food database, structured (not embedded randomly in UI code). Emphasis on Indian foods: rice, roti, chapati, paratha, dal, sabzi, paneer, chicken, mutton, fish, eggs, fruits, vegetables, snacks, sweets, dairy, beverages, common packaged foods where appropriate. Bengali household foods, a substantial set, for example: macher jhol, macher curry, bhapa, shorshe preparations, dal, aloo posto, shukto, cholar dal, luchi, paratha, rice, khichuri, chicken curry, mutton curry, egg curry, various vegetable preparations, common Bengali snacks and sweets; not limited to these. Restaurant/hotel foods, categories: Indian, Bengali, Chinese, Japanese, Thai, Continental, fast food, pizza, burgers, sandwiches, biryani, fried rice, noodles, chow mein, desserts, beverages, snacks. Restaurant nutrition values must be explicitly treated as estimates where exact values are unavailable. The food-data agent designs a broad practical dataset. Conceptual food structure: id, name, category, cuisine, serving definitions, calories, protein, carbs, fat, fiber, source/type, custom/system flag. Exact schema is decided by architecture agents. The implementation workflow must include a dedicated data/content phase for the initial food database.

## Serving system

Serving size is extremely important. Food supports multiple units where practical. Examples: Rice: 100 g, 1 cup, 1 bowl, 1 serving. Egg: 1 egg, 100 g. Dal: 100 ml, 1 bowl, 1 cup. Fish: 1 piece, 100 g. Model: Food, then serving definitions, then nutritional values. The user selects a quantity.

## Custom food

User-created foods with: name, category, calories, protein, carbs, fat, fiber, serving name, serving quantity, weight/volume where relevant, notes. Custom foods appear in the normal food logging interface.

## Recipes

Composite foods. Example: Chicken Biryani with rice, chicken, oil, onion, potato, spices. Recipe calculates total nutrition. Supports recipe creation, ingredient selection, ingredient quantities, number of servings, nutrition per serving. Saved recipes behave like reusable food items.

## Food history

Recent foods, frequently used foods, favorite foods, to make daily logging extremely fast.

## Targets

Per-user configurable targets: calories, protein, carbohydrates, fat, fiber, water, steps. Not hardcoded globally. Optional goal modes (weight loss, maintenance, muscle gain) are configuration concepts, not mandatory automated recommendations.

## Exercise library

Fields: exercise name, category, muscle group, exercise type, default reps/time, default calorie estimate, difficulty, instructions, optional notes. Conceptual structure: id, name, category, muscle groups, type, default target, unit, calorie estimate, instructions, system/custom; final schema determined by planning. Examples: Push-ups, Backpack Rows, Pike Push-ups, Reverse Flys, Plank, Squats, Backpack Romanian Deadlifts, Reverse Lunges, Glute Bridges, Dead Bugs, Biceps Curls, Overhead Triceps Extensions, Hamstring Walkouts, Calf Raises, Wall Sit, Running, Brisk Walking, Suryanamaskar, Cat-Cow Flow, Child's Pose. Not exhaustive; the exercise database must be extensible.

## Six default workout plans

1. Upper Body - Push & Pull: 10 Push-ups; 12 Backpack Rows; 8 Pike Push-ups; 12 Reverse Flys; 30-second Plank. Daily step goal 7,000.
2. Lower Body & Core: 15 Squats; 12 Backpack Romanian Deadlifts; 10 Reverse Lunges (each leg); 15 Glute Bridges; 10 Dead Bugs (each side). Daily step goal 7,000.
3. Active Recovery & Yoga: Suryanamaskar 5 to 10 rounds; Cat-Cow Flow 10 to 12 transitions; Child's Pose 1 to 2 minutes. Daily step goal 7,000.
4. Upper Body - Arms Focus: 10 Push-ups; 12 Backpack Rows; 8 Pike Push-ups; 12 Biceps Curls; 12 Overhead Triceps Extensions. Daily step goal 7,000.
5. Lower Body & Cardio: 15 Squats; 10 Hamstring Walkouts; 20 Calf Raises; 30-second Wall Sit; 20-30 minutes Running or Brisk Walking. Daily step goal 7,000.
6. Complete Rest: no formal workout. Daily step goal 10,000.

## No fixed weekday rule (very important)

Workouts must NOT be mapped to fixed days of the week (for example, no rule that the first day of the week is always the upper-body workout). Every day the user can select any available split. Example: today Upper Body Push & Pull, tomorrow Complete Rest, next day Lower Body & Core. The user may repeat, skip, change or select another workout.

## Editable plans

The user can: create plans, rename plans, add exercises, remove exercises, reorder exercises, modify target reps, modify target duration, modify target distance where relevant, modify calorie estimates, change the step goal associated with a plan, duplicate a plan, delete a plan. Historical workout logs must be preserved; changing a plan must NOT silently rewrite historical workout records.

## Completion percentage

Each exercise in a workout allows completion tracking. Reps: target 10 push-ups, actual 7 gives 70%. Time-based: target 30 seconds, completed 20 gives 67%. Distance/time activity: target 30 minutes, completed 22 gives 73%. The user can manually enter a completion percentage when a direct quantitative calculation is not appropriate.

## Exercise calorie burn

Each exercise has an estimated calorie-burn value. Estimated calories are calculated from the exercise, user-specific body weight where appropriate, duration/reps where appropriate, and the configured/default calorie estimate. The UI must clearly label exercise calorie values as estimates. Users can override/customize calorie values per exercise.

## Steps

Daily: actual steps, step goal, percentage completed. Default targets include 7,000 and 10,000 but are configurable.

## Water

Default 1 glass = 500 ml. User logs number of glasses; the system calculates glasses x 500 ml and displays glasses consumed, total ml, total litres, daily target, percentage completed. Custom glass sizes may be allowed later; 500 ml is the default.

## Sleep

Daily: bedtime, wake time, total sleep duration, sleep quality (simple rating such as 1-5), optional nap, optional notes. The system generates sleep trends.

## Body measurements

Logged over time. Initial: height, weight, body fat %, biceps, thigh, waist. Potential additional: chest, hips, neck, calf. Every measurement has date, value, unit, optional note. Body fat % is treated as approximate/estimated, not clinical.

## Measurement graphs

Each measurement has a graph of change over time (weight, waist, biceps, body fat, etc., each as date vs value). Graphs support time range, latest value, previous value, change, trend. Avoid misleading visualizations.

## Progress photos

Intended cadence weekly or biweekly. A check-in may contain front, side, back, optional flexed photo, date, notes. The app allows comparison of photos across dates (for example Week 1 vs Week 2, Week 2 vs Week 3, Week 1 vs Week 4). Photos are private and remain local unless the user explicitly chooses another storage mechanism.

## Check-ins

Weekly/biweekly progress check-in may include: weight, body fat, measurements, progress photos, average calories, average protein, average steps, average sleep, workout completion, notes. The app allows comparing different periods.

## Notes

Optional daily notes/journal (not mandatory). Examples: ate outside, travel day, poor sleep, busy workday, skipped workout, illness, special occasion, restaurant meal.

## Dashboard

Excellent, visually strong, easy-to-understand daily summary. Example content: Calories 1,420 / 1,900 kcal; Protein 82 / 120 g; Carbs 150 / 220 g; Fat 45 / 60 g; Steps 5,830 / 7,000; Water 2.5 / 3.0 L; Sleep 7h 12m; Workout 74% complete; Exercise calories ~210 kcal.

## Analytics

Meaningful trends: weight, body fat, waist, protein consistency, calorie intake, step consistency, water consistency, sleep consistency, workout completion, exercise calorie estimates. Views: daily, weekly, monthly, custom date range. Do not overcomplicate V1.

## Data integrity

Historical records are protected from accidental mutation. Example: an exercise with 0.5 kcal/repetition later changed to 0.6 must NOT recalculate historical workout records. If food macros change later, historical food logs retain the nutritional snapshot used when logged. The architecture must distinguish master/reference data from historical logged data.

## Validation

Prevent obvious invalid entries: negative weight, negative calories, impossible quantities, accidental enormous water quantities, invalid percentages, invalid dates. Distinguish No data entered from 0.

## Privacy / lock

Consider a local PIN/passcode lock, evaluated as a V1/V1.1 feature. It must not introduce a backend requirement.

## UX requirements (extremely important)

Do NOT create a generic CRUD dashboard. Feel like a polished modern health application. Mobile-first, responsive, desktop-friendly, excellent typography, clear hierarchy, fast interactions, minimal friction, excellent empty states, clear feedback, smooth but restrained animations, accessible controls, good contrast, touch-friendly controls, easy navigation, strong visual representation of progress. Modern and premium without expensive assets or infrastructure. Avoid unnecessary WebGL or flashy effects; performance is more important than visual gimmicks.

## Speed of logging

A user should be able to: 1 open the app, 2 select themselves, 3 see today's dashboard, 4 add food, 5 add water, 6 add steps, 7 select today's workout, 8 record workout completion, 9 record sleep, 10 finish, without navigating dozens of screens.

## Food logging UX

Prioritize speed: search, favorites, recent foods, categories, quick add, serving selector, quantity stepper, meal selector, custom food, recipe selection.

## Workout logging UX

The workout screen shows exercise, target, actual, completion %, estimated calories. The user can rapidly enter completion.

## Testing

At least one dedicated testing agent inspects the complete app. Functional: user selection, food logging, custom food, recipe, meals, macro calculation, exercise selection, workout editing, workout logging, completion %, calorie estimates, steps, water, sleep, measurements, graphs, photos, check-ins, notes, export, import. Data: persistence after refresh, persistence after browser restart, historical records, data integrity, import/export, schema migration. UI: mobile, desktop, tablet, touch, accessibility, empty states, error states. Performance: initial load, large food database, large log history, large number of measurements, multiple images.

## Rework and final audit

At least one dedicated rework/refinement agent after testing; it receives the complete implementation state, QA findings, UX findings and architecture issues, must FIX issues rather than just report them, then provides another structured handoff. A final audit agent performs an end-to-end audit verifying: requirements coverage, UX quality, data persistence, zero-cost deployment, GitHub Pages compatibility, backup/restore, mobile usability, desktop usability, no broken flows, no placeholder functionality, no accidental external dependencies, no unnecessary paid services.

## Agent orchestration

Independent Claude chats; the human manually copies output from one chat into the next. Each agent must output a structured JSON handoff plus a ready-to-paste prompt for the next agent, never assuming another agent can see earlier chats. Planning phase: about 4-5 planning agents (areas: requirements, data/storage, UX/UI, zero-cost deployment/technical architecture, final integration). The final planning agent produces: complete consolidated plan, final architecture, data model, technology stack, UX/UI plan, deployment plan, zero-cost strategy, implementation-agent pipeline, complete consolidated JSON, prompt for the first implementation agent, and wholeplan.md. wholeplan.md is a human-understandable document containing at least: project overview, goals, architecture, technology stack, data architecture, storage strategy, food system, exercise system, workout plan system, daily logging, measurements, progress photos, analytics, UX/UI principles, security/privacy, backup/restore, GitHub Pages deployment, zero-cost strategy, file/folder structure, implementation sequence, testing strategy, agent sequence, definition of done.

## Implementation pipeline

After planning, a second pipeline of approximately 10+ implementation/review agents, each with a clearly defined non-overlapping responsibility (not 20 agents repeating work). For each agent define: role, objective, inputs, files it may modify, files it must not unnecessarily modify, required outputs, validation requirements, dependencies, handoff format, next-agent prompt. Every implementation agent outputs a structured JSON handoff including items such as: agent, project_state, work_completed, files_created, files_modified, architecture_decisions, known_issues, testing_performed, remaining_work, instructions_for_next_agent, next_agent_prompt. The schema may be improved, and must be complete enough for the next independent chat to continue. Final agents provide complete source files, correct folder structure, configuration files, data files, documentation, deployment instructions, backup instructions, and any required GitHub Pages configuration. No pseudo-code where a working application is the goal.

## Final deployment experience

The human creates a new GitHub repository, places the generated files according to the final instructions, enables GitHub Pages if required, opens the URL, and the app works. No missing backend, no missing database, no paid service, no hidden dependency preventing normal operation.

## Traceability

Maintain a requirements traceability system throughout the pipeline. Every major requirement has: requirement ID, description, planning decision, implementation location, test coverage, final status. The final agent must be able to demonstrate that requirements were not silently forgotten.

## V1 vs V2 discipline

Continually distinguish Required for V1 from Nice-to-have from Future V2. Do not allow scope creep to prevent the app from becoming deployable. The final V1 must be genuinely usable.

## Communication contract

Every agent is one worker in a larger chain of independent Claude chats: never assume previous context exists outside the provided handoff, never say as discussed earlier unless present in the supplied input, preserve important decisions, identify contradictions, resolve conflicts explicitly, never silently discard requirements, produce structured output, produce the next prompt.

## Final success criteria

At the end the human has: a complete Winter Arc application; all source files; all data files; polished UI; responsive mobile/desktop experience; persistent local data; food database; exercise database; editable workout plans; daily workout selection without fixed weekday mapping; nutrition tracking; macro tracking; step tracking; water tracking; sleep tracking; measurement tracking; progress photos; graphs; weekly/biweekly check-ins; export/import; data integrity; QA-tested functionality; zero-cost deployment architecture; GitHub Pages deployment instructions; wholeplan.md; a simple explanation of exactly where each file goes in the GitHub repository; a deployed app that works by opening the GitHub Pages URL. It must be something the two users can actually use every day, not a prototype.
