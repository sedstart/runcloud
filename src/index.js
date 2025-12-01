import * as core from '@actions/core';
import fetch from "node-fetch";
// ------- Pretty Print (same as Orb style) ------------------
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIndex = 0;

function clearScreen() {
    process.stdout.write('\x1b[2J\x1b[0;0H');
}

function emoji(status = "") {
    const st = status.toUpperCase();
    if (st === "PASS" || st === "SUCCESS") return "✅";
    if (st === "FAIL" || st === "FAILURE") return "❌";
    if (st.includes("IN")) return "⏳";
    return "ℹ️";
}

function logPretty(obj) {
    if (!obj?.result) {
        console.log("[sedstart]", JSON.stringify(obj));
        return;
    }

    const result = obj.result;
    const type = (result.type || "").toLowerCase();

    if (type === "run") {
        const pref = emoji(result.status);
        console.log(`${pref} ${result.status}`);

        if (result.error) console.log(`❌ Error: ${result.error}`);
        if (Array.isArray(result.video)) {
            result.video.forEach(v => console.log(`🎥 ${v}`));
        }
        return;
    }

    if (type === "test") {
        clearScreen();

        const name = result.name || "<unnamed>";
        const st = result.status || "UNKNOWN";
        const upper = st.toUpperCase();
        const spin = (!upper || upper.includes("IN")) ? spinnerFrames[spinnerIndex++ % spinnerFrames.length] : "";

        console.log(`🧪 Test: ${name} — ${st} ${spin}`);

        const items = Array.isArray(result.items) ? result.items : [];
        for (const testStep of items) {
            if ((testStep.type || "").toLowerCase() !== "teststep") continue;

            console.log(`  • ${testStep.name} — ${testStep.status}`);

            for (const stepItem of testStep.items || []) {
                if ((stepItem.type || "").toLowerCase() !== "stepitem") continue;

                console.log(`    - ${stepItem.name} — ${stepItem.status}`);

                for (const action of stepItem.items || []) {
                    if ((action.type || "").toLowerCase() !== "resourceelementaction") continue;

                    console.log(`      → ${action.name} — ${action.status}`);
                }
            }
        }
    }
}

async function run() {
    try {
        const apiKey = core.getInput("api_key", { required: true });
        const projectId = core.getInput("project_id", { required: true });
        const testId = core.getInput("test_id");
        const suiteId = core.getInput("suite_id");
        const profileId = core.getInput("profile_id", { required: true });
        const browser = core.getInput("browser", { required: true });
        const headless = core.getInput("headless") === "true";
        const environment = core.getInput("environment") || "Prod";
        if (!testId && !suiteId) {
            core.setFailed("You must provide either test_id or suite_id.");
            return;
        }
        let idPayload = {};

        if (suiteId) {
            idPayload.suite_id = Number(suiteId);
        } else {
            idPayload.test_id = Number(testId);
        }

        // ✅ Determine Base URL
        const baseUrl =
            environment.toLowerCase() === "qa"
                ? "https://sedstart.sedinqa.com"
                : "https://app.sedstart.com";

        const url = `${baseUrl}/api/project/${projectId}/runCI`;

        console.log(`🚀 Triggering SedStart CI Run: ${url}`);

        const payload = {
            project_id: Number(projectId),
            ...idPayload,
            profile_id: Number(profileId),
            browser,
            headless
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": "APIKey " + apiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`HTTP ${response.status}: ${text}`);
        }

        console.log("📡 Streaming events...");

        // ✅ Node.js Readable Stream (NOT getReader())
        const stream = response.body;

        let buffer = "";
        let finalStatus = "UNKNOWN";

        stream.on("data", (chunk) => {
            const text = chunk.toString();
            buffer += text;

            const parts = buffer.split(/\r?\n/);
            buffer = parts.pop();

            for (const line of parts) {
                if (!line.trim()) continue;

                if (!line.startsWith("data:")) continue;

                const jsonText = line.slice(5).trim();
                let obj;

                try {
                    obj = JSON.parse(jsonText);
                } catch {
                    console.log(`⚠️ Could not parse event: ${jsonText}`);
                    continue;
                }

                // ✅ HUMAN-FRIENDLY LOGGING
                logPretty(obj);

                // ✅ Extract ONLY the test result status
                if (obj?.result?.status) {
                    finalStatus = obj.result.status;
                    console.log(`✅ Result Status Updated → ${finalStatus}`);
                }
            }
        });


        stream.on("end", () => {
            console.log("✅ SSE Stream ended.");

            if (finalStatus === "PASS" || finalStatus === "SUCCESS") {
                console.log(`✅ Test Finished: ${finalStatus}`);
                core.setOutput("result", finalStatus);
            } else {
                core.setFailed(`❌ Test Finished with status: ${finalStatus}`);
            }
        });

        stream.on("error", (err) => {
            core.setFailed(`❌ Stream error: ${err.message}`);
        });

    } catch (error) {
        core.setFailed(`❌ Action failed: ${error.message}`);
    }
}

run();