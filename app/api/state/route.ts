import { NextResponse } from "next/server";
import { AppError, getAppState, requireAppUser } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAppUser();
    return NextResponse.json(await getAppState(user));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
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
