// Server-side proxy to the services; only the calls in @workspace/core/proxy pass.
export { proxy as DELETE, proxy as GET, proxy as POST } from "@workspace/core/handlers"
