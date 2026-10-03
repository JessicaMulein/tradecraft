The one thing left worth making is the cue map: the rules that tell the game which track plays when. Without it, the tracks are just a folder of audio. Every trigger below is something the Sim already tracks, so the audio layer can be driven entirely by game events:

| Game state                                   | Cue                                                          | Transition                                                   |
| -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Title and new-game setup                     | Title theme, looping its middle section                      | Covers the image render batch too                            |
| Exploring a Western sector or the Inner City | Exploration (day), or the night variant in evening and night phases | After about 10 minutes, drop to the ambience bed for a while |
| Exploring the Soviet sector                  | Soviet variant                                               | Crossfade over 2–3 seconds at a phrase boundary when the player crosses in |
| Café or hotel scene                          | Café trio or hotel-bar piano                                 | Lower the volume while NPC dialogue streams                  |
| High-stakes conversation                     | Interrogation                                                | Switch to the cracking variant when the NPC's cover state becomes cracking |
| Sector crossing                              | Checkpoint                                                   | Then the cleared or detained stinger, then the new sector's track |
| Cipher workbench                             | Workbench                                                    | "Cipher solved" stinger on success                           |
| Numbers-station intercept                    | Interval signal, then the spoken digits                      | All music stops underneath                                   |
| Pursuit                                      | Pursuit                                                      | A beat of silence, then exploration                          |
| An asset is burned                           | Stinger                                                      | Then 20–30 seconds of ambience only                          |
| Game over                                    | Success, burned, or the burned opening for a plot-completes failure | No loop; let it end in silence                               |

Three general rules go with the table:

- Only one music cue plays at a time, except during crossfades.
- Ambience beds run continuously underneath and keep going when music drops out.
- Silence is a deliberate state the map can choose, not just the absence of a cue.

Once that's wired up, the next real input is playing a session and noting where it feels wrong.
