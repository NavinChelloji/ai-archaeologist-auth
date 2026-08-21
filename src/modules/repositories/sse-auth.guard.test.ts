import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { RequestWithUser } from "../auth/access-token.guard";
import { SseAuthGuard } from "./sse-auth.guard";

function fakeContext(request: Partial<RequestWithUser>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function fakeAccessTokens(userId = "user-1") {
  return { verify: vi.fn(() => ({ userId })) };
}

describe("SseAuthGuard", () => {
  it("accepts a Bearer header, same as the ordinary access-token guard", () => {
    const accessTokens = fakeAccessTokens();
    const guard = new SseAuthGuard(accessTokens as never);
    const request: Partial<RequestWithUser> = { headers: { authorization: "Bearer good-token" } };

    expect(guard.canActivate(fakeContext(request))).toBe(true);
    expect(accessTokens.verify).toHaveBeenCalledWith("good-token");
    expect(request.userId).toBe("user-1");
  });

  it("falls back to an access_token query parameter when there's no header — EventSource can't set one", () => {
    const accessTokens = fakeAccessTokens();
    const guard = new SseAuthGuard(accessTokens as never);
    const request: Partial<RequestWithUser> = { headers: {}, query: { access_token: "query-token" } };

    expect(guard.canActivate(fakeContext(request))).toBe(true);
    expect(accessTokens.verify).toHaveBeenCalledWith("query-token");
  });

  it("prefers the header over the query parameter when both are present", () => {
    const accessTokens = fakeAccessTokens();
    const guard = new SseAuthGuard(accessTokens as never);
    const request: Partial<RequestWithUser> = {
      headers: { authorization: "Bearer header-token" },
      query: { access_token: "query-token" },
    };

    guard.canActivate(fakeContext(request));

    expect(accessTokens.verify).toHaveBeenCalledWith("header-token");
  });

  it("rejects when neither a header nor a query token is present", () => {
    const guard = new SseAuthGuard(fakeAccessTokens() as never);
    const request: Partial<RequestWithUser> = { headers: {}, query: {} };

    expect(() => guard.canActivate(fakeContext(request))).toThrow();
  });
});
