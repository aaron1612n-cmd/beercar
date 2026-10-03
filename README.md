# Beercar

Drive a '67 Camaro down an endless winding road. Chug beer, smoke cigars, don't crash. You can't get out.

**Play:** https://aaron1612n-cmd.github.io/beercar/

**Goal:** get as many miles down the road as you can without crashing. Your best run is kept in the browser.

| Key | |
|---|---|
| W / S | gas / brake, reverse |
| A / D | steer |
| Space | handbrake (drift) |
| Mouse | look around |
| ` | drink beer |
| Q | smoke cigar |
| G | autopilot on / off |
| F | game speed 1x / 2x / 4x / 8x |
| C | camera (chase cam: the mouse looks all the way round) |
| R | reset |
| M | mute |
| H | help |
| Esc | menu |
| Alt + F + 4 | ??? |

Hit a tree, post or telegraph pole over 10 mph and the car blows up.

**The law:** hitchhiker kids stand in the road. Hit 3 and a cop car comes after you, 6 brings a second,
9 a third (and you'll hear a helicopter). The cops are kids too. Stay more than 300 m ahead of all of them
for 10 seconds to lose them; let one ram you, or sit still next to one, and you're BUSTED. Cops that hit
something at speed wreck.

(The fruit-fly-brain driving mode was removed; it's in commit 3861371.)

## Run locally

```
npm install
npm run dev
```

`node tools/drivecheck.mjs` (car physics + autopilot on real track), `node tools/chasecheck.mjs`
(wanted / escape / bust rules) and `node tools/trackcheck.mjs` (road generator) are the headless checks.

Built with three.js + Vite.

## Credits

- Car: "1967 Chevrolet Camaro SS 350 Coupe" by Ddiaz Design (https://sketchfab.com/3d-models/1967-chevrolet-camaro-ss-350-coupe-37ecedd9b5284cbfae74956eea2ad3fd), CC-BY-NC-SA 4.0. Non-commercial; derivatives must share alike.
- Police car: This work is based on "Police car" (https://sketchfab.com/3d-models/police-car-9166b13b6ae341f4bfc093edb71d74f4) by Mateusz Woliński (https://sketchfab.com/jeandiz) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- Sky HDRI, bark and ground textures: Poly Haven (CC0).
- Driver and hitchhikers: Ready Player Me avatar.
