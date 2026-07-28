import { NextResponse } from "next/server";
import {
  AppError,
  getAppState,
  parseAppAction,
  performAction,
  requireAppUser,
} from "@/lib/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireAppUser();
    const action = parseAppAction(await request.json());
    await performAction(user, action);
    return NextResponse.json(await getAppState(user));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }
  console.error(error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
      },
    },
    { status: 500 },
  );
}
