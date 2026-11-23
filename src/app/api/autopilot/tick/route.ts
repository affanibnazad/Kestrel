// Autopilot is parked (r9). Endpoint returns 404 Not Found.
export const maxDuration = 60;

export async function POST() {
  return new Response("Not found", { status: 404 });
}

export async function GET() {
  return new Response("Not found", { status: 404 });
}
