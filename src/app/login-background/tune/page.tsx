'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@wallarm-org/design-system/Button';
import { SegmentedControl } from '@wallarm-org/design-system/SegmentedControl';
import { SegmentedControlItem } from '@wallarm-org/design-system/SegmentedControl';
import { Switch } from '@wallarm-org/design-system/Switch';
import { SwitchControl } from '@wallarm-org/design-system/Switch';
import { SwitchLabel } from '@wallarm-org/design-system/Switch';
import { LoginBackground, DEFAULTS, type Texture } from '@/components/login-background';

type Accent = 'red' | 'orange';

const ACCENT_VARS: Record<Accent, string> = {
  red: '--color-red-500',
  orange: '--color-w-orange-500',
};

interface Knobs {
  texture: Texture;
  spacing: number;
  sweepPeriod: number;
  bloomRadius: number;
  anomalyInterval: number;
  intensity: number;
  bloomAlpha: number;
  maxDotSize: number;
  tilt: number;
  accent: Accent;
  paused: boolean;
}

function defaultsFor(texture: Texture): Knobs {
  const d = DEFAULTS[texture];
  return {
    texture,
    spacing: d.spacing,
    sweepPeriod: 12.5,
    bloomRadius: d.bloomRadius,
    anomalyInterval: 1.4,
    intensity: 0.9,
    bloomAlpha: 0.2,
    maxDotSize: d.maxDotSize,
    tilt: 16,
    accent: 'red',
    paused: false,
  };
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, onChange }: SliderProps) {
  return (
    <label className="flex flex-col gap-6">
      <span className="flex items-baseline justify-between text-xs font-medium text-[var(--color-text-secondary)]">
        <span>{label}</span>
        <span className="font-mono text-[var(--color-text-primary)]">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-w-orange-500)]"
      />
    </label>
  );
}

export default function LoginBackgroundPlayground() {
  const [knobs, setKnobs] = useState<Knobs>(() => defaultsFor('halftone'));
  const [dark, setDark] = useState(false);

  // Playground-only theme switch so the dark token swap can be checked without
  // changing OS settings. The real page will set data-theme from system theme.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    return () => root.removeAttribute('data-theme');
  }, [dark]);

  const set = <K extends keyof Knobs>(key: K, value: Knobs[K]) =>
    setKnobs((prev) => ({ ...prev, [key]: value }));

  // Texture switching resets the tuning knobs to that texture's defaults, but
  // accent / paused / tilt are texture-independent so we carry them over.
  const switchTexture = (texture: Texture) =>
    setKnobs((prev) => ({
      ...defaultsFor(texture),
      accent: prev.accent,
      paused: prev.paused,
      tilt: prev.tilt,
    }));

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[var(--login-bg-base)]">
      {/* The animated field. In production the real form sits on top of this. */}
      <LoginBackground
        texture={knobs.texture}
        spacing={knobs.spacing}
        sweepPeriod={knobs.sweepPeriod}
        bloomRadius={knobs.bloomRadius}
        anomalyInterval={knobs.anomalyInterval}
        intensity={knobs.intensity}
        bloomAlpha={knobs.bloomAlpha}
        maxDotSize={knobs.maxDotSize}
        tilt={knobs.tilt}
        accentColorVar={ACCENT_VARS[knobs.accent]}
        paused={knobs.paused}
      />

      {/* Preview-only mock card — NOT shipped. Stands in for the real login form. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="pointer-events-auto h-640 w-480 rounded-xl border border-[var(--color-border-primary)] bg-white p-32 shadow-xl" />
      </div>

      {/* Back to the prototypes hub. */}
      <div className="absolute left-16 top-16 z-50">
        <Link href="/">
          <Button variant="outline" color="neutral">
            ← All prototypes
          </Button>
        </Link>
      </div>

      {/* Tuning controls — the Storybook substitute for this prototype. */}
      <aside className="absolute right-16 top-16 flex w-300 flex-col gap-16 rounded-xl border border-[var(--color-border-primary)] bg-[var(--color-bg-surface-1)] p-20 shadow-lg">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">
            Detection sweep
          </span>
          <Switch checked={dark} onCheckedChange={(e) => setDark(e.checked)}>
            <SwitchControl />
            <SwitchLabel>
              <span className="text-xs text-[var(--color-text-secondary)]">Dark</span>
            </SwitchLabel>
          </Switch>
        </div>

        <div className="flex flex-col gap-8">
          <SegmentedControl
            fullWidth
            value={knobs.texture}
            onChange={(v) => switchTexture(v as Texture)}
          >
            <SegmentedControlItem value="clean">Clean</SegmentedControlItem>
            <SegmentedControlItem value="halftone">8-bit halftone</SegmentedControlItem>
          </SegmentedControl>
        </div>

        <div className="flex flex-col gap-8">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">
            Anomaly color
          </span>
          <SegmentedControl
            fullWidth
            value={knobs.accent}
            onChange={(v) => set('accent', v as Accent)}
          >
            <SegmentedControlItem value="red">Red</SegmentedControlItem>
            <SegmentedControlItem value="orange">Orange</SegmentedControlItem>
          </SegmentedControl>
        </div>

        <Slider
          label="Intensity"
          value={knobs.intensity}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => set('intensity', v)}
        />
        <Slider
          label="Bloom opacity"
          value={knobs.bloomAlpha}
          min={0.15}
          max={0.9}
          step={0.01}
          onChange={(v) => set('bloomAlpha', v)}
        />
        <Slider
          label="Spacing (px)"
          value={knobs.spacing}
          min={8}
          max={40}
          step={1}
          onChange={(v) => set('spacing', v)}
        />
        <Slider
          label="Sweep period (s)"
          value={knobs.sweepPeriod}
          min={2}
          max={15}
          step={0.5}
          onChange={(v) => set('sweepPeriod', v)}
        />
        <Slider
          label="Bloom radius (px)"
          value={knobs.bloomRadius}
          min={10}
          max={120}
          step={1}
          onChange={(v) => set('bloomRadius', v)}
        />
        <Slider
          label="Anomaly interval (s)"
          value={knobs.anomalyInterval}
          min={1}
          max={12}
          step={0.1}
          onChange={(v) => set('anomalyInterval', v)}
        />
        {knobs.texture === 'halftone' && (
          <Slider
            label="Max dot size (px)"
            value={knobs.maxDotSize}
            min={4}
            max={40}
            step={1}
            onChange={(v) => set('maxDotSize', v)}
          />
        )}

        <Slider
          label="Tilt (deg)"
          value={knobs.tilt}
          min={0}
          max={30}
          step={1}
          onChange={(v) => set('tilt', v)}
        />

        <Switch
          checked={knobs.paused}
          onCheckedChange={(e) => set('paused', e.checked)}
        >
          <SwitchControl />
          <SwitchLabel>
            <span className="text-xs text-[var(--color-text-secondary)]">
              Freeze (reduced-motion preview)
            </span>
          </SwitchLabel>
        </Switch>

        <Button variant="outline" color="neutral" onClick={() => switchTexture(knobs.texture)}>
          Reset to defaults
        </Button>

        <p className="text-xs leading-relaxed text-[var(--color-text-tertiary)]">
          Real <code>prefers-reduced-motion</code> is honored automatically — the
          loop never starts and one static frame renders.
        </p>
      </aside>
    </main>
  );
}
