import type { OverlayOption } from '@playground/store/uiStore';
import { UiSection } from '@playground/components/primitives/UiSection';

interface DebugOverlaySectionProps {
  overlay: OverlayOption;
  setOverlay: (value: OverlayOption) => void;
  options: OverlayOption[];
}

export function DebugOverlaySection({ overlay, setOverlay, options }: DebugOverlaySectionProps) {
  return (
    <UiSection title="Debug Overlay">
      <select
        value={overlay}
        onChange={(event) => setOverlay(event.target.value as OverlayOption)}
        className="tf-input"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </UiSection>
  );
}
