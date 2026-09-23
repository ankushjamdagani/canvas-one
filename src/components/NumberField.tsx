import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="field open-inspector-field">
      <Label asChild>
        <span className="open-inspector-field-label">{label}</span>
      </Label>
      <div className="input-unit open-inspector-input-unit flex items-stretch rounded-control border border-input bg-shell shadow-sm transition-colors focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
        <Input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            if (e.target.value !== "")
              onChange(Math.min(max, Math.max(min, Number(e.target.value))));
          }}
          className="h-8 pointer-coarse:h-11 flex-1 min-w-0 border-0 shadow-none rounded-none bg-transparent focus-visible:outline-none focus-visible:border-transparent"
        />
        {unit && (
          <span className="open-inspector-field-unit flex items-center whitespace-nowrap border-l border-border px-2 text-xs text-secondary-text">
            {unit}
          </span>
        )}
      </div>
    </label>
  );
}
