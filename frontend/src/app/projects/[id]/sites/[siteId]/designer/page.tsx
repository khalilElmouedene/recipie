"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import PinDesigner from "@/components/PinDesigner";
import { api, RecipeOut } from "@/lib/api";

export default function PinDesignerPage() {
  const params = useParams<{ id: string; siteId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const recipeId = searchParams.get("recipe");
  const [recipes, setRecipes] = useState<RecipeOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.siteId) return;
    api.getRecipes(params.siteId)
      .then(setRecipes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.siteId]);

  const targetRecipe = recipeId ? recipes.find((r) => r.id === recipeId) : recipes[0];
  const allImages: string[] = [];
  const recipesToUse = targetRecipe ? [targetRecipe] : recipes;
  recipesToUse.forEach((recipe) => {
    if (recipe.generated_images) {
      try {
        const arr = JSON.parse(recipe.generated_images);
        if (Array.isArray(arr)) {
          arr.forEach((url) => {
            if (url && !allImages.includes(url)) allImages.push(url);
          });
        }
      } catch {}
    }
    if (recipe.image_url && !allImages.includes(recipe.image_url)) {
      allImages.push(recipe.image_url);
    }
  });

  const recipeTitle = targetRecipe?.recipe_text?.split("\n")[0]?.trim() || "Recipe Title";
  const recipeDesc = targetRecipe?.meta_description || targetRecipe?.recipe_text?.split("\n")[0]?.trim() || "";

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  return (
    <PinDesigner
      templateName={recipeTitle}
      initialTitle={recipeTitle}
      recipeImages={allImages}
      projectId={params.id}
      siteId={params.siteId}
      recipeId={recipeId || undefined}
      recipePinTitle={targetRecipe?.pin_title || recipeTitle}
      recipePinDescription={targetRecipe?.pin_description || recipeDesc}
      onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
    />
  );
}
