import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 4 Attachments Upload, Link, and Host-Scoped Download", () => {
  it("uploads raw file bytes with signed headers, links URLs, and scopes Authorization strictly to uploads.linear.app", async () => {
    const fetchLog: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    let createdAttachmentInput: unknown = null;

    const harness = await createAuthenticatedTestHarness(
      {
        issue: (async () => ({
          id: "iss-11",
          identifier: "NIN-11",
          team: Promise.resolve({ id: "t-1", key: "NIN", name: "NineAI" }),
          attachments: async () => ({
            nodes: [
              {
                id: "att-1",
                title: "log.txt",
                subtitle: null,
                url: "https://uploads.linear.app/org/asset-1",
                createdAt: "2026-11-25T00:00:00.000Z",
              },
            ],
          }),
        })) as never,
        attachment: (async (id: string) => {
          if (id === "att-linear") {
            return {
              id: "att-linear",
              title: "private.txt",
              url: "https://uploads.linear.app/org/private.txt",
            };
          }
          return {
            id: "att-ext",
            title: "external.txt",
            url: "https://example.com/public.txt",
          };
        }) as never,
        fileUpload: (async (contentType: string, filename: string, size: number) => ({
          success: true,
          uploadFile: {
            uploadUrl: "https://storage.googleapis.com/linear-upload-signed/123",
            assetUrl: "https://uploads.linear.app/org/uploaded-123",
            contentType,
            filename,
            size,
            headers: [
              { key: "x-goog-meta-linear", value: "signed-val" },
              { key: "cache-control", value: "public, max-age=31536000" },
            ],
          },
        })) as never,
        createAttachment: (async (input: unknown) => {
          createdAttachmentInput = input;
          return {
            success: true,
            attachment: Promise.resolve({ id: "att-created" }),
          };
        }) as never,
        deleteAttachment: (async () => ({ success: true })) as never,
      },
      {
        fetchImpl: async (input, init) => {
          const url = String(input);
          const hdrs = (init?.headers ?? {}) as Record<string, string>;
          fetchLog.push({ url, method: init?.method ?? "GET", headers: { ...hdrs } });
          if (init?.method === "PUT") {
            return new Response("", { status: 200 });
          }
          return new Response("downloaded-file-bytes", { status: 200 });
        },
      },
    );
    cleanups.push(harness.cleanup);

    // 1. Upload file
    const sampleFile = path.join(harness.folder, "log.txt");
    fs.writeFileSync(sampleFile, "hello linear storage");
    const uploadRes = await harness.exec([
      "attachment",
      "upload",
      "--issue",
      "NIN-11",
      "--file",
      sampleFile,
      "--json",
    ]);
    expect(uploadRes.code).toBe(0);
    expect(fetchLog[0]).toEqual({
      url: "https://storage.googleapis.com/linear-upload-signed/123",
      method: "PUT",
      headers: {
        "Content-Type": "text/plain",
        "x-goog-meta-linear": "signed-val",
        "cache-control": "public, max-age=31536000",
      },
    });
    expect(createdAttachmentInput).toEqual({
      issueId: "iss-11",
      url: "https://uploads.linear.app/org/uploaded-123",
      title: "log.txt",
    });

    // 2. Download from uploads.linear.app -> MUST include Authorization
    const outLinear = path.join(harness.folder, "out-linear.txt");
    const dlLinear = await harness.exec(["attachment", "download", "att-linear", "--output", outLinear, "--json"]);
    expect(dlLinear.code).toBe(0);
    expect(fetchLog[1]?.headers.Authorization).toBe("lin_api_test_secret_12345678");
    expect(fs.readFileSync(outLinear, "utf8")).toBe("downloaded-file-bytes");

    // 3. Download from external domain -> MUST NOT include Authorization!
    const outExt = path.join(harness.folder, "out-ext.txt");
    const dlExt = await harness.exec(["attachment", "download", "att-ext", "--output", outExt, "--json"]);
    expect(dlExt.code).toBe(0);
    expect(fetchLog[2]?.headers.Authorization).toBeUndefined();
  });
});
