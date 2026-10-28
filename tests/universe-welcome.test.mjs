import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const extensionURL = new URL(".github/extensions/universe-welcome/extension.mjs", root);
const source = await readFile(extensionURL, "utf8");
const guide = await readFile(new URL(".github/extensions/universe-welcome/walkthroughs.js", root), "utf8");
const html = await readFile(new URL(".github/extensions/universe-welcome/welcome.html", root), "utf8");
const context = { window: {} };
vm.runInNewContext(guide, context);
const guides = context.window.WALK;

async function harness() {
    const state = { sent: [] };
    let registration;
    const session = {
        // No auth, metadata, repository, or fork API is needed to use the guide.
        send: async ({ prompt }) => {
            state.sent.push(prompt);
        },
    };
    const script = source.replace(/^import .*;\r?\n/gm, "").replaceAll("import.meta.url", JSON.stringify(extensionURL.href));
    await vm.runInNewContext(`(async()=>{${script}})()`, {
        createServer, readFile, URL,
        joinSession: async (options) => { registration = options; return session; },
        createCanvas: (options) => options,
    });
    return { state, canvas: registration.canvases[0] };
}

test("canvas serves its page and guide assets", async () => {
    const { canvas } = await harness();
    const { url } = await canvas.open({ instanceId: "browse" });
    try {
        const page = await fetch(url);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /Get Started/);
        const walkthroughs = await fetch(`${url}walkthroughs.js`);
        assert.equal(walkthroughs.status, 200);
        assert.match(await walkthroughs.text(), /window\.WALK/);
        assert.equal((await fetch(`${url}unknown`)).status, 404);
    } finally {
        await canvas.onClose({ instanceId: "browse" });
    }
});

test("guide examples send their configured prompts to the owning chat", async () => {
    const { canvas, state } = await harness();
    const { url } = await canvas.open({ instanceId: "send" });
    const post = (body) => fetch(`${url}try`, {
        method: "POST", headers: { Origin: new URL(url).origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    try {
        for (const [id, expectedPrompt] of [
            ["skills", /following the Skills guide/],
            ["tools", /Tools and Connectors guide/],
            ["security", /Security review guide/],
            ["automate", /Automate guide/],
        ]) {
            const response = await post({ id, text: "ignored client text" });
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { ok: true });
            assert.match(state.sent.at(-1), expectedPrompt);
        }
        assert.equal((await post({ id: "missing" })).status, 400);
        assert.equal(state.sent.length, 4);
    } finally {
        await canvas.onClose({ instanceId: "send" });
    }
});

test("skill guide explains the skill, its edit, and the sample issue", () => {
    const steps = guides.skills.steps;
    assert.equal(steps[0].h, "Understand how a skill is built");
    assert.equal(steps[1].h, "Edit the skill");
    assert.equal(steps[2].h, "Create a sample issue");
    assert.match(JSON.stringify(steps[0]), /frontmatter/);
    assert.match(JSON.stringify(steps[1]), /How to test/);
    assert.match(JSON.stringify(steps[2]), /Add a list command to universe-notes/);
    assert.doesNotMatch(guide, /git reset --hard/);
    assert.match(JSON.stringify(steps[0]), /openSkill/);
    assert.equal(steps[0].body.some((block) => typeof block === "object" && block.img), false);
    assert.doesNotMatch(guide, /gear menu|Show tracked hidden files|open-files\.png/);
    assert.match(JSON.stringify(guides.tools), /Context7/);
    assert.match(JSON.stringify(guides.tools), /documentation source/);
    assert.match(html, /Context7/);
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
});

test("launch links target the welcome canvas and instructions preserve deferred-fork boundaries", async () => {
    for (const path of ["README.md", "02-github-copilot-latest-features/README.md"]) {
        const text = await readFile(new URL(path, root), "utf8");
        const link = text.match(/https:\/\/github\.com\/copilot\/app\/launch\?open=[^\s)]+/)[0];
        const target = new URL(new URL(link).searchParams.get("open"));
        assert.equal(target.searchParams.get("repo"), "octodemo/virtual-universe-26");
        assert.equal(target.searchParams.get("canvas"), "universe-welcome");
    }
    const instructions = await readFile(new URL(".github/copilot-instructions.md", root), "utf8");
    assert.match(instructions, /universe-welcome/);
    assert.match(instructions, /Do not list the parts/);
    assert.match(instructions, /need no fork/);
    assert.match(instructions, /preserving|Keep the current checkout/);
    assert.match(instructions, /factory is bound to the app project/);
    const skill = await readFile(new URL(".github/skills/issue-to-pr/SKILL.md", root), "utf8");
    assert.match(skill, /push only to/);
    assert.match(skill, /never implicitly to origin/);
    assert.match(skill, /Do not open or switch sessions/);
});
