/**
 * Resolve the latest published tarball for an npm package.
 *
 * Hits the registry's `/latest` dist-tag endpoint (small JSON), pulls
 * `dist.tarball` from the result. Scoped names are URL-encoded.
 */
export async function resolveTarball(
  packageName: string,
  signal?: AbortSignal,
): Promise<{ version: string; tarballUrl: string }> {
  const encoded = packageName.replace("/", "%2F");
  const url = `https://registry.npmjs.org/${encoded}/latest`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(
      `npm registry returned ${res.status} for ${packageName}`,
    );
  }

  const meta = (await res.json()) as {
    version?: string;
    dist?: { tarball?: string };
  };

  if (!meta.version || !meta.dist?.tarball) {
    throw new Error(`registry response missing version or tarball URL`);
  }

  return { version: meta.version, tarballUrl: meta.dist.tarball };
}
