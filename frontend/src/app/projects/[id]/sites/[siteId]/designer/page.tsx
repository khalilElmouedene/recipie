"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PinDesigner, { FrameInfo } from "@/components/PinDesigner";
import { api, RecipeOut } from "@/lib/api";

function getRecipeImages(r: RecipeOut): string[] {
  const images: string[] = [];
  if (r.generated_images) {
    try {
      const arr = JSON.parse(r.generated_images);
      if (Array.isArray(arr)) arr.forEach((url: string) => { if (url?.trim()) images.push(url.trim()); });
    } catch {}
  }
  if (r.image_url && !images.includes(r.image_url)) images.push(r.image_url);
  return images;
}

export default function PinDesignerPage() {
  const params = useParams<{ id: string; siteId: string }>();
  const router = useRouter();
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.siteId) return;
    api.getRecipes(params.siteId)
      .then((all) => {
        const generated = all.filter((r) => r.status === "generated" || r.status === "published");
        const source = generated.length > 0 ? generated : all;
        setFrames(source.map((r) => ({
          recipeId: r.id,
          title: r.recipe_text?.split("\n")[0]?.trim() || "Recipe",
          images: getRecipeImages(r),
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.siteId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  return (
    <PinDesigner
      frames={frames}
      projectId={params.id}
      siteId={params.siteId}
      onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
    />
  );
}
