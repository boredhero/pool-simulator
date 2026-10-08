# Placement camera and rack results (0.9.4)

After an accepted human cue-ball placement, the existing automatic-camera preference
can frame a clear legal pot lane. A conservative geometric helper filters legal
object balls, kitchen restrictions, blocked paths, cut angle and travel distance.
It frames the cue, ghost contact, target and pocket behind the shot axis. It is a
camera aid, not a simulated guarantee of a pot. It does not change aim, spin, power
or calls. When no suitable lane exists, placement uses the legal-target overview.

Online placement assistance requires the server to acknowledge the submitted
position for the same room and seat. Manual camera input while waiting cancels
that assistance. Automatic framing remains optional, yields to input and respects
reduced motion. Practice, CPU and Jev placement do not invoke the human assist.

Completed racks show a centered native result dialog after playback and pending
state updates settle. Names come from room participants, the signed-in local
account, CPU/Jev, or the Player 1/2 fallback. A short local CSS confetti animation
is omitted for reduced motion. Dismissing the result leaves the finished table
visible and repeated HUD updates do not reopen it.

Play again retains the local opponent mode. Premium Jev replay requests a new
authoritative game and displays errors without inventing a successful restart.
After a daily non-premium Jev game, the action explicitly starts a local rack.
New online session leaves the completed room and creates a fresh room with a new
invite; it does not silently enroll the other participant in a rematch.

The persistent header account control opens the existing account dialog and
restores focus to its invoking button. Long names are visually truncated with
full accessible labels. The desktop input profile sits above the legal controls;
the camera movement pad remains separate and available to touch users.

## Opening coin and responsive Jev shots

A denarius-style coin animation reveals the opening player for every new local
rack and server game. Offline racks use browser cryptographic randomness. Jev
chooses and persists its breaker on creation; resuming never rerolls. Online
rooms choose once when both players join and broadcast the same result. The
animation is presentation only: it cannot change the authoritative result.
Player and AI shots wait for the reveal, pending remote playback is queued, and
leaving/restarting cancels stale animation. Welcome and practice take precedence.
Reduced motion receives a brief static result.

Human Jev strokes start local physics immediately on release, matching the
existing online-room prediction model. The immutable submitted shot still goes
to the server for validation and full simulation. Local settling cannot advance
the turn or declare a winner: it waits for the authoritative state. A response
never strikes the same human shot twice. Network failures let visible motion
finish and require an explicit resume, which fetches saved server state; they do
not silently retry a potentially committed shot.
