import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const readFile = (path: string): string => {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${path}`);
  }
  return readFileSync(fullPath, "utf-8");
};

describe("Issue #203: Lock interface orientation to portrait on iPhone", () => {
  const infoPlistPath = "ios/App/App/Info.plist";

  describe("iPhone orientation configuration", () => {
    it("restricts UISupportedInterfaceOrientations to portrait only", () => {
      const plist = readFile(infoPlistPath);

      // Find the UISupportedInterfaceOrientations block (iPhone-specific, without ~ipad suffix)
      const iphoneOrientationsMatch = plist.match(
        /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/
      );

      expect(iphoneOrientationsMatch).toBeTruthy();

      const iphoneOrientationsBlock = iphoneOrientationsMatch![1];

      // Must contain Portrait
      expect(iphoneOrientationsBlock).toMatch(
        /<string>UIInterfaceOrientationPortrait<\/string>/
      );

      // Must NOT contain LandscapeLeft
      expect(iphoneOrientationsBlock).not.toMatch(
        /<string>UIInterfaceOrientationLandscapeLeft<\/string>/
      );

      // Must NOT contain LandscapeRight
      expect(iphoneOrientationsBlock).not.toMatch(
        /<string>UIInterfaceOrientationLandscapeRight<\/string>/
      );

      // Must NOT contain PortraitUpsideDown (iPhone doesn't support this)
      expect(iphoneOrientationsBlock).not.toMatch(
        /<string>UIInterfaceOrientationPortraitUpsideDown<\/string>/
      );
    });

    it("contains exactly one orientation value (Portrait)", () => {
      const plist = readFile(infoPlistPath);

      const iphoneOrientationsMatch = plist.match(
        /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/
      );

      expect(iphoneOrientationsMatch).toBeTruthy();

      const iphoneOrientationsBlock = iphoneOrientationsMatch![1];

      // Count <string> tags in the iPhone orientations array
      const stringTags = iphoneOrientationsBlock.match(/<string>/g);
      expect(stringTags).toHaveLength(1);
    });
  });

  describe("iPad orientation configuration remains unchanged", () => {
    it("preserves all four orientations for iPad", () => {
      const plist = readFile(infoPlistPath);

      // Find the UISupportedInterfaceOrientations~ipad block
      const ipadOrientationsMatch = plist.match(
        /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>([\s\S]*?)<\/array>/
      );

      expect(ipadOrientationsMatch).toBeTruthy();

      const ipadOrientationsBlock = ipadOrientationsMatch![1];

      // Must contain Portrait
      expect(ipadOrientationsBlock).toMatch(
        /<string>UIInterfaceOrientationPortrait<\/string>/
      );

      // Must contain PortraitUpsideDown
      expect(ipadOrientationsBlock).toMatch(
        /<string>UIInterfaceOrientationPortraitUpsideDown<\/string>/
      );

      // Must contain LandscapeLeft
      expect(ipadOrientationsBlock).toMatch(
        /<string>UIInterfaceOrientationLandscapeLeft<\/string>/
      );

      // Must contain LandscapeRight
      expect(ipadOrientationsBlock).toMatch(
        /<string>UIInterfaceOrientationLandscapeRight<\/string>/
      );
    });

    it("contains exactly four orientation values for iPad", () => {
      const plist = readFile(infoPlistPath);

      const ipadOrientationsMatch = plist.match(
        /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>([\s\S]*?)<\/array>/
      );

      expect(ipadOrientationsMatch).toBeTruthy();

      const ipadOrientationsBlock = ipadOrientationsMatch![1];

      // Count <string> tags in the iPad orientations array
      const stringTags = ipadOrientationsBlock.match(/<string>/g);
      expect(stringTags).toHaveLength(4);
    });
  });
});
