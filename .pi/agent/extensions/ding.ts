/**
 * Let you know when Pi finishes working: a ding plus a desktop notification.
 *
 * Listens for the `agent_settled` event, which fires after an agent run has
 * fully settled with no automatic retry, compaction, or queued continuation
 * left to run. A completion that ended in a tool error still counts as settled,
 * so you can tell when the noise stops that Pi is idle again.
 *
 * - Ding: a synthesized bell "DING" (ding.wav, see gen-ding.py). The first
 *   usable (player, sound) pair is cached; if a cached player later fails
 *   (e.g. audio daemon stopped), the cache resets and the next settle
 *   re-probes. Customize with PI_DING_SOUND.
 * - Notification: `notify-send` to the desktop notification daemon, showing
 *   "Pi finished" with the first few lines of the final assistant message.
 *
 * Both are fired in the background (not awaited) so settlement is never
 * delayed, and both are silent/failed quietly. An aborted run (Escape) does
 * not ding or notify.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Player binaries, in priority order. paplay/pw-play decode .oga; ffplay is the fallback. */
const PLAYERS = ["paplay", "pw-play", "ffplay"];
/** Candidate ding sounds, tried in order until one exists on disk. */
const SOUNDS = [
	process.env.PI_DING_SOUND,
	// Synthesized bell ding that ships alongside this extension.
	new URL("./ding.wav", import.meta.url).pathname,
	"/usr/share/sounds/freedesktop/stereo/bell.oga",
	"/usr/share/sounds/freedesktop/stereo/complete.oga",
	"/usr/share/sounds/freedesktop/stereo/message.oga",
].filter((s): s is string => !!s);

let cached: { player: string; sound: string } | undefined;
/** True once we've probed the machine, so we don't re-run `which`/`test` every settle. */
let probed = false;

interface TextPart {
	type: "text";
	text: string;
}

/** First few lines of the most recent assistant text, for the notification body. */
function previewFinalMessage(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const content = entry.message.content;
		const chunks =
			typeof content === "string"
				? [content]
				: content.filter((c): c is TextPart => c.type === "text").map((c) => c.text);
		const text = chunks.join("\n").replace(/\s+$/, "");
		if (!text) continue;
		const snippet = text.split("\n").slice(0, 3).join("\n");
		return snippet.length > 180 ? `${snippet.slice(0, 177).replace(/\s+$/, "")}…` : snippet;
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	pi.on("agent_settled", async (event, ctx) => {
		// Escape/abort is not "done working" — stay quiet.
		if (event.aborted) return;

		// Desktop notification with a snippet of the final answer. Fire and
		// forget — don't block settlement on the notify round-trip.
		const body = previewFinalMessage(ctx) ?? "Pi finished working.";
		pi.exec("notify-send", ["-a", "pi", "--", "Pi finished", body]).catch(() => {});

		// Resolve the first (player, sound) that exists. `which` and `test` are
		// real binaries — `command -v` is a shell builtin and would fail here.
		// The probe is a few quick `which`/`test` calls, so awaiting it on the
		// first settle only is fine.
		if (!cached && !probed) {
			probed = true;
			outer: for (const sound of SOUNDS) {
				for (const player of PLAYERS) {
					try {
						const found = await pi.exec("which", [player]);
						if (found.code !== 0) continue;
						const exists = await pi.exec("test", ["-f", sound]);
						if (exists.code !== 0) continue;
						cached = { player, sound };
						break outer;
					} catch {
						// Player missing or not executable — try the next candidate.
					}
				}
			}
		}

		if (!cached) return;

		// Fire and forget — don't block settlement on audio output. ffplay needs
		// -nodisp/-autoexit so it exits when the clip ends instead of opening a window.
		const args = cached.player === "ffplay" ? ["-nodisp", "-autoexit", cached.sound] : [cached.sound];
		pi.exec(cached.player, args)
			.then((result) => {
				// Self-heal: a cached player that stops working (code !== 0, e.g.
				// audio daemon down) resets the cache so the next settle re-probes.
				if (result.code !== 0) {
					cached = undefined;
					probed = false;
				}
			})
			.catch(() => {
				cached = undefined;
				probed = false;
			});
	});
}
