// Splits a headline into words so each one can blur and rise into place, one after another (Framer-style).
export default function Words({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span key={i}>{i ? " " : ""}<span className="word" style={{ animationDelay: `${delay + i * 70}ms` }}>{w}</span></span>
      ))}
    </>
  );
}
