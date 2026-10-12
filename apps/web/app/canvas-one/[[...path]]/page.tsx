import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StandaloneApp } from "../../../../../src/standalone/StandaloneApp";

type PageProps = { params: Promise<{ path?: string[] }> };
const basePath = `${(process.env.NEXT_PUBLIC_CANVAS_BASE_PATH || "").replace(/\/$/, "")}/canvas-one`;

async function resolveRoute(params: PageProps["params"]) {
  const { path = [] } = await params;
  const initialPath = path.length
    ? `/${path.map(encodeURIComponent).join("/")}`
    : "/";
  const kind =
    path.length === 0
      ? "home"
      : path.length === 1 && path[0] === "brand"
        ? "brand"
        : path.length === 1 && path[0] === "projects"
          ? "projects"
          : path[0] === "project" &&
              (path.length === 2 || (path.length === 4 && path[2] === "branch"))
            ? "project"
            : null;
  if (!kind) notFound();
  return { initialPath, kind };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { kind } = await resolveRoute(params);
  const site = process.env.CANVAS_SITE_URL;
  if (kind === "projects" || kind === "project") {
    return {
      title: kind === "projects" ? "Projects" : "Workspace",
      robots: { index: false, follow: false },
    };
  }
  return {
    ...(kind === "brand"
      ? {
          title: "Brand",
          description:
            "Canvas One brand guidelines, visual language and interface foundations.",
        }
      : {}),
    ...(site
      ? {
          alternates: {
            canonical: `${new URL(site).origin}${basePath}${kind === "brand" ? "/brand" : "/"}`,
          },
        }
      : {}),
  };
}

/** Reuse the repository's complete standalone app at a second local mount. */
export default async function Page({ params }: PageProps) {
  const { initialPath } = await resolveRoute(params);
  return (
    <StandaloneApp
      initialPath={initialPath}
      basePath={basePath}
      siteOrigin={process.env.CANVAS_SITE_URL}
    />
  );
}
