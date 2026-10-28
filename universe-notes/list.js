import { readFileSync } from "node:fs";

const { highlights } = JSON.parse(
  readFileSync(new URL("./notes/keynote-highlights.json", import.meta.url), "utf8"),
);
const topics = new Map();

for (const { topic, title } of highlights) {
  const titles = topics.get(topic) ?? [];
  titles.push(title);
  topics.set(topic, titles);
}

for (const [topic, titles] of topics) {
  console.log(topic);
  for (const title of titles) {
    console.log(`  - ${title}`);
  }
}
