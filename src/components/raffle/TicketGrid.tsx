import type { TicketStatus } from "@/lib/raffle";
import { cn } from "@/lib/utils";

type Props = {
  start: number;
  end: number;
  taken: Record<string, TicketStatus>;
  selected: number[];
  disabled?: boolean;
  onToggle: (n: number) => void;
};

export function TicketGrid({ start, end, taken, selected, disabled, onToggle }: Props) {
  const numbers: number[] = [];
  for (let n = start; n <= end; n++) numbers.push(n);

  return (
    <div className="mt-6 grid grid-cols-5 sm:grid-cols-10 gap-2 sm:gap-2.5">
      {numbers.map((n) => {
        const status = taken[String(n)];
        const isSold = status === "sold";
        const isHeld = status === "held" || status === "pending";
        const isSelected = selected.includes(n);
        const locked = isSold || isHeld || disabled;

        return (
          <button
            key={n}
            type="button"
            aria-disabled={locked && !isSelected}
            aria-label={`Number ${n}${isSold ? " sold" : isHeld ? " held" : ""}`}
            onClick={() => !locked && onToggle(n)}
            className={cn(
              "aspect-square rounded-lg font-mono text-sm font-medium grid place-items-center transition-transform",
              isSelected &&
                "bg-tomato text-tomato-foreground font-semibold animate-pop shadow-sm",
              !isSelected &&
                isSold &&
                "bg-parchment text-foreground/30 cursor-not-allowed",
              !isSelected &&
                isHeld &&
                "bg-tomato/25 text-tomato/80 line-through cursor-not-allowed",
              !isSelected &&
                !isSold &&
                !isHeld &&
                "bg-cream ring-1 ring-inset ring-foreground/20 active:translate-y-0.5 active:scale-95 hover:ring-tomato/60",
              disabled && !isSelected && "opacity-60 cursor-not-allowed",
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}
