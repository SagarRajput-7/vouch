import { describe, expect, it } from "vitest";
import { vendorKey } from "@/lib/normalize/vendor";

describe("vendorKey", () => {
  it("groups spellings of the same vendor", () => {
    expect(vendorKey("Acme Corp.")).toBe("acme");
    expect(vendorKey("ACME Corporation")).toBe("acme");
    expect(vendorKey("acme corp")).toBe("acme");
    expect(vendorKey("Halcyon Cloud Services Inc.")).toBe("halcyon cloud services");
    expect(vendorKey("Meridian Office Supplies Ltd")).toBe("meridian office supplies");
  });
  it("keeps distinct vendors distinct", () => {
    expect(vendorKey("Acme Logistics")).not.toBe(vendorKey("Acme Corp"));
  });
});
