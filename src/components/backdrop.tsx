import Gradient from "@/components/gradient";

// One continuous background for the whole page, in layers:
// 1. the moving colour, fixed to the screen (it never scrolls away or gets cut off),
// 2. fine grain,
// 3. a frosted veil that fades in softly below the page title, so text stays easy to read
//    while the colour still glows through everywhere.
// "fade" = a first guess of where the title area ends; the top bar measures the real value (--fade) once the page loads.
export default function Backdrop({ fade = 320 }: { fade?: number }) {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-colour"><Gradient /></div>
      <div className="backdrop-veil" style={{ ["--fade-guess" as string]: `${fade}px` }} />
    </div>
  );
}
