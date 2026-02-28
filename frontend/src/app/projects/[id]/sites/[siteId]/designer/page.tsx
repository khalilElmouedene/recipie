"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PinDesigner from "@/components/PinDesigner";
import { api, RecipeOut } from "@/lib/api";

export default function PinDesignerPage() {
  const params = useParams<{ id: string; siteId: string }>();
  const router = useRouter();
  const [recipes, setRecipes] = useState<RecipeOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.siteId) return;
    api.getRecipes(params.siteId)
      .then(setRecipes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.siteId]);

  const allImages: string[] = [];
  recipes.forEach((recipe) => {
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

  const firstRecipe = recipes[0];
  const title = firstRecipe?.recipe_text?.split("\n")[0] || "Recipe Title";

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  return (
    <PinDesigner
      templateName={title}
      initialTitle={title}
      recipeImages={allImages}
      onClose={() => router.push(`/projects/${params.id}/sites/${params.siteId}`)}
    />
  );
}
