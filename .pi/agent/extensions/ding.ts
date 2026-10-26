/**
 * Play a short ding when Pi finishes working.
 *
 * Listens for the `agent_settled` event, which fires after an agent run has
 * fully settled with no automatic retry, compaction, or queued continuation
 * left to run. A completion that ended in a tool error still counts as settled,
 * so you can tell when the noise stops that Pi is idle again.
 *
 * The sound is played in the background (not awaited) so settlement is never
 * delayed. The first usable (player, sound) pair is cached; if a cached player
 * later fails (e.g. audio daemon stopped), the cache resets and the next settle
 * re-probes. Everything is silent on failure. An aborted run (Escape) does not
 * ding.
 *
 * The default sound is a synthesized bell "DING" shipped next to this file
 * (ding.wav), generated with a short Python stdlib script. Customize the
 * sound with the PI_DING_SOUND environment variable, e.g.:
 *   PI_DING_SOUND=/path/to/my-sound.wav pi
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export default function (pi: ExtensionAPI) {
	pi.on("agent_settled", async (event) => {
		// Escape/abort is not "done working" — stay quiet.
		if (event.aborted) return;

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
