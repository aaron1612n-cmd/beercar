# Beercar

Drive a '67 Camaro down an endless road. Chug beer, smoke cigars, don't crash. You can't get out.
Or let a fruit fly drive.

**Play:** https://aaron1612n-cmd.github.io/beercar/

Pick a mode on the menu (`1` / `2`), `Esc` goes back to it.

## 1 · You drive

| Key | |
|---|---|
| W / S | gas / reverse |
| A / D | steer |
| Space | brake |
| ` (spam it) | chug beer |
| Alt + F + 4 | ??? |
| Q | smoke cigar |
| C | camera |
| G | game speed 1x / 2x / 4x / 8x |
| R | reset |
| M | mute |

Hit a tree, post or telegraph pole and the car blows up.

## 2 · The fly drives

A giant fruit fly sits in the driver's seat, running a real fruit fly brain: all 138,639 neurons of the
FlyWire connectome, simulated as spiking neurons (the model of Shiu et al. 2024) in a Web Worker.

- **Eyes:** two little cameras in its head render the game; each of its ~4,700 lamina cells (L1-L3)
  fires according to how dark its patch of the view is.
- **Hands:** the wheel listens to 150 cells it picks from its own visual system. An instructor drives
  lessons while the fly learns which cells mean "steer left" (recursive least squares on that last link;
  the brain's wiring itself never changes). Hold A / D to teach it yourself, `T` to let it drive solo.
- **Mouth:** beer on its taste hairs drives its sugar neurons, and its MN9 motor neuron decides whether
  the proboscis comes out and it drinks: the feeding pathway Shiu et al. found in this exact model.
- **Thirst:** whether it goes for the beer is learned by reward: buzz going up is rewarded, buzz fading
  is punished. Alcohol damps every synapse in its brain a little.

| Key | |
|---|---|
| W / S | cruise speed |
| hold A / D | take the wheel and teach it |
| T | lesson / solo |
| ` | pour it a beer |
| X | wipe its training |

Its training is saved in your browser. `tools/` has the script that packs the connectome
(`build-flybrain.py`) and the Node checks used to tune it (`flytrain.mjs` drives a drawn road headlessly).

## Run locally

```
npm install
npm run dev
```

Built with three.js + Vite.

## Credits

- Car: "1967 Chevrolet Camaro SS 350 Coupe" by Ddiaz Design (https://sketchfab.com/3d-models/1967-chevrolet-camaro-ss-350-coupe-37ecedd9b5284cbfae74956eea2ad3fd), CC-BY-NC-SA 4.0. Non-commercial; derivatives must share alike.
- Sky HDRI, bark and ground textures: Poly Haven (CC0).
- Driver: Ready Player Me avatar.
- Fly brain: FlyWire connectome v783 (Dorkenwald et al. 2024, *Nature*; Schlegel et al. 2024, *Nature*), cell annotations from https://github.com/flyconnectome/flywire_annotations. Spiking model, connectivity files, sugar neuron and MN9 ids from Shiu et al. 2024, *Nature*, https://github.com/philshiu/Drosophila_brain_model (MIT).
