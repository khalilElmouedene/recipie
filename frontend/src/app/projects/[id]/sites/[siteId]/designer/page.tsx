"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const recipeParam = searchParams.get("recipe");

  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [singleRecipe, setSingleRecipe] = useState<RecipeOut | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.siteId) return;

    if (recipeParam) {
      // Single-recipe mode: opened from Pinterest tab
      api.getRecipe(recipeParam)
        .then(setSingleRecipe)
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      // Multi-frame mode: all generated recipes
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
    }
  }, [params.siteId, recipeParam]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  if (singleRecipe) {
    // Single-recipe mode — Save button appears in header
    return (
      <PinDesigner
        recipeId={singleRecipe.id}
        recipeImages={getRecipeImages(singleRecipe)}
        initialTitle={singleRecipe.recipe_text?.split("\n")[0]?.trim() || "Recipe"}
        initialJson={singleRecipe.pin_design_image?.startsWith("{") ? singleRecipe.pin_design_image : undefined}
        recipePinTitle={singleRecipe.pin_title ?? ""}
        recipePinDescription={singleRecipe.pin_description ?? ""}
        projectId={params.id}
        siteId={params.siteId}
        onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
      />
    );
  }

  // Multi-frame mode — Save All saves to all recipes
  return (
    <PinDesigner
      frames={frames}
      projectId={params.id}
      siteId={params.siteId}
      onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
    />
  );
}
