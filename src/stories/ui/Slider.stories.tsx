import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

const meta: Meta<typeof Slider> = {
  title: "UI/Slider",
  component: Slider,
  tags: ["autodocs"],
};

export default meta;

export const Default: StoryObj<typeof Slider> = {
  render: () => {
    const [val, setVal] = React.useState([45]);
    return (
      <div className="space-y-3 max-w-sm">
        <div className="flex justify-between items-center text-xs">
          <Label>Cache Hit Ratio</Label>
          <span className="font-mono font-semibold text-primary">
            {val[0]}%
          </span>
        </div>
        <Slider value={val} onValueChange={setVal} max={100} step={1} />
      </div>
    );
  },
};

export const MultiSlider: StoryObj<typeof Slider> = {
  render: () => {
    const [concurrency, setConcurrency] = React.useState([80]);
    const [jitter, setJitter] = React.useState([15]);

    return (
      <div className="space-y-6 max-w-sm p-4 rounded-card border border-control-border bg-shell">
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-medium">Target QPS Load</span>
            <span className="font-mono text-primary font-semibold">
              {concurrency[0] * 10} req/s
            </span>
          </div>
          <Slider
            value={concurrency}
            onValueChange={setConcurrency}
            max={100}
            step={5}
          />
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-medium">Network Jitter (ms)</span>
            <span className="font-mono text-primary font-semibold">
              {jitter[0]} ms
            </span>
          </div>
          <Slider value={jitter} onValueChange={setJitter} max={50} step={1} />
        </div>
      </div>
    );
  },
};

export const Range: StoryObj<typeof Slider> = {
  render: () => {
    const [range, setRange] = React.useState([20, 80]);
    return (
      <div className="max-w-sm space-y-2">
        <div className="flex justify-between font-mono text-xs">
          <span>{range[0]} s</span>
          <span>{range[1]} s</span>
        </div>
        <Slider
          value={range}
          onValueChange={setRange}
          step={1}
          minStepsBetweenThumbs={1}
          thumbLabels={["Range start", "Range end"]}
          thumbValueTexts={range.map((value) => `${value} seconds`)}
        />
      </div>
    );
  },
};
