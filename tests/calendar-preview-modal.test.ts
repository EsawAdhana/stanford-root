import { describe, expect, it } from "vitest";
import { addBlockedReason } from "@/components/calendar-preview-modal";

describe("section preview: why Add to Calendar is disabled", () => {
    it("asks for units while a variable-unit class has none picked", () => {
        expect(addBlockedReason(true, undefined)).toBe("Pick units to add this class.");
    });

    it("says nothing once units are picked, including 0", () => {
        expect(addBlockedReason(true, 3)).toBeNull();
        expect(addBlockedReason(true, 0)).toBeNull();
    });

    it("says nothing for a fixed-unit class", () => {
        expect(addBlockedReason(false, undefined)).toBeNull();
    });
});
