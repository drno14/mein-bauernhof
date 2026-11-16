# Mein Bauernhof

Ein 3D-Bauernhof-Spiel im Browser (three.js, WebGPU mit WebGL2-Fallback). Dieselbe Figur und dieselbe Welt wie
„Mein erstes Spiel“ – aber ohne Häuser und Handwerk: nur Wiesen, Wald, Hügel, Kühe, Schafe und Pferde.

## Starten

```bash
npm install
npm run dev
```

Dann http://127.0.0.1:5173/ öffnen und ins Bild klicken.

## Spielen

Du startest mit 150 Münzen und einem fertigen Stall (2 Hühner, 1 Schaf, 1 Pferd).

| Taste | Aktion |
|---|---|
| Maus | lenken (ins Bild klicken) |
| W / Shift+W / Leertaste | gehen / sprinten / springen |
| **B** | Menü: Stall bauen, Feld anlegen, Tiere kaufen, Saatgut wählen |
| **F** | beim Stall: Eier, Wolle, Milch, Dünger einsammeln und verkaufen · beim Feld: säen / ernten |
| **E** | aufs Pferd steigen / absteigen (W/S, A/D, Shift = Galopp) |
| N · T | Wetter wechseln · +2 Stunden |

- **Ställe** werden direkt vor dir gebaut (Platz lassen!). Die Tiere liefern von allein:
  - Stall: 200 Münzen, 6 Tiere
  - Grosser Stall: 600 Münzen, 14 Tiere
  - Gestüt: 700 Münzen, nur Pferde, 8 Plätze, mehr Dünger – aus zwei Pferden wird nach einer Weile ein Fohlen
- **Hofladen** (300 Münzen): holt Waren aus den Ställen in der Nähe (bis 70 m) und verkauft sie mit 30 % Aufschlag.
  Mit F leerst du die Kasse.
- **Tiere**: Huhn 30, Schaf 80, Kuh 150, Pferd 250 Münzen. Sie kommen in den nächsten Stall mit freiem Platz.
- **Felder** (40 Münzen): Weizen, Karotten oder Kürbisse säen, warten, ernten.
- Steigst du ausserhalb des Stalls vom Pferd, bleibt es dort – es gehört dir weiter und du kannst es wieder reiten.
- Der Hof wird automatisch im Browser gespeichert.

Andere Welt: `?seed=42` an die Adresse anhängen.

## Lizenzen

Alle 3D-Modelle sind CC0 – Details in [`public/models/LIZENZEN.txt`](public/models/LIZENZEN.txt).
