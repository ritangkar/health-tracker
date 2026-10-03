# Winter Arc seed data: attribution and licence register

All food, exercise and plan values in the `data/` folder were written for this project (source id `src-author`). They are approximate, typical values from general nutrition knowledge. No database, website or book was copied.

## Approximate values (read this)

Nutrition values are approximate. Home-cooked dishes vary with ingredients, oil and portion size. Restaurant, hotel, sweet-shop and street foods are marked **estimate** and can be far from what you were served. Exercise calories are rough estimates for a 70 kg adult and scale with body weight. None of this is medical or dietetic advice. Check packaged foods against their label and use the custom food form for exact values.

## Confidence levels

| Level | Meaning |
| --- | --- |
| verified | Reserved. Only for a value checked against a cited source whose licence allows use. None in this seed. |
| typical | Home-style or basic food, project-authored typical value. |
| estimate | Restaurant, hotel, street or mixed dish, or any value the author is unsure of. |

## Source register

| Id | Source | Status | Notes |
| --- | --- | --- | --- |
| src-author | Project-authored values | Used | The only source of seed values. |
| src-ifct2017 | Indian Food Composition Tables 2017 (NIN/ICMR) | NOT imported | Copyright holder is NIN/ICMR and it is not an open licence. The companion website is AGPL-3.0 since 1 May 2025; no code or data was copied. May be used to sanity-check raw staples, with acknowledgement. |
| src-indb | Indian Nutrient Databank | Not used | Licence not verified. |
| src-usda | USDA FoodData Central | Not used | Believed public domain. Verify date and URL before any use. |
| src-labels | Values typed by users from a pack label | User data | Custom foods only; never part of the seed. |

## Seed files

| File | Contents |
| --- | --- |
| seed-manifest.json | Seed version, file list with counts, source register |
| categories.json | 22 food categories and 9 cuisines (field `group` tells them apart) |
| meal-categories.json | Breakfast, Lunch, Snacks, Dinner, Other |
| measurement-types.json | Body measurement types (six active in V1, four reserved) |
| exercises.json | 60 exercises |
| plans.json | The six default workout plans |
| foods-starter.json | 44 starter foods |
| foods-staples-a.json | 132 staples: rice and grains, flours and millets, breads, legumes and dals, eggs |
| foods-staples-b.json | 198 staples: dairy, beverages, fruit, raw and boiled vegetables, oils, nuts and seeds, sweeteners, spices and condiments |
| foods-indian-home-a.json | 179 Indian home dishes: sabzi and vegetable curries, dal gravies, paneer, chicken, mutton, fish and egg dishes, snacks and chaat |
| foods-indian-home-b.json | 187 Indian home foods B: sweets and desserts (halwa, kheer, laddu, burfi), biryani, pulao and khichdi, breakfast breads and dosas, regional dishes, raitas, chutneys, pickles and snacks |
| foods-bengali.json | 165 Bengali foods: macher jhol, kalia, bhapa, shorshe and ilish dishes, posto, shukto and vegetable dishes, cholar dal and other dals, luchi, khichuri, pulao, meat and egg dishes, snacks, chutneys and Bengali sweets (prefix bn-) |
| foods-restaurant-indian.json | 105 restaurant and hotel Indian and Bengali foods (estimates): biryani and rice plates, kebabs and tandoor items, breads, North and South Indian restaurant gravies, Kolkata rolls, cutlets and chops, thali plates, street and hotel snacks, a few desserts (prefix ri-) |
| foods-packaged.json | 84 generic packaged foods (estimates, no brands): biscuits and bakery, namkeen and snacks, instant mixes and powders, ready-to-eat pouches, canned and frozen items, breakfast cereals, bars and sweets, spreads, packaged dairy and drinks (prefix pk-) |
| foods-restaurant-world-a.json | 191 restaurant world foods A (estimates): Chinese and Indo-Chinese fried rice, noodles and chow mein, Manchurian and chilli dishes, momos, dim sum, spring rolls, soups and a few desserts; Japanese sushi, ramen, katsu, teriyaki and donburi; Thai curries, noodles, soups and salads (prefix wa-) |
| foods-restaurant-world-b.json | 190 restaurant world foods B (estimates): pizza and calzone, garlic bread, Italian pasta, risotto and lasagne, continental soups and salads, steaks, chicken and fish plates, sides, American burgers, hot dogs, fried chicken and fries, Tex-Mex fast food, wraps, sandwiches and subs, breakfast items (prefix wb-) |
| foods-restaurant-world-c.json | 197 restaurant world foods C (estimates): cakes, pastries, ice cream and frozen desserts; cafe coffees, teas, mocktails, milkshakes, smoothies and juices; cafe and bakery snacks, bowls and dips; sauces, dressings, toppings and after-meal extras (prefix wc-) |

This is the last planned food chunk. Later seed updates may add more files.

## Changing the seed

Any change under `data/` needs a new seed version: increase `seedVersion` in `seed-manifest.json` and `WA_SEED_VERSION` in `version.js` by the same step. Seed ids are never reused. A removed item is kept with `"deprecated": true`; a merged item gets `"replacedBy"`.
