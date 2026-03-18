"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import PinDesigner, { FrameInfo } from "@/components/PinDesigner";
import { api, RecipeOut, GeneratedJobRecipeOut } from "@/lib/api";

function imagesFromJobRecipe(r: GeneratedJobRecipeOut): string[] {
  const images: string[] = [];
  if (r.generated_images) {
    try {
      const arr = JSON.parse(r.generated_images);
      if (Array.isArray(arr)) arr.forEach((url: string) => { if (url?.trim()) images.push(url.trim()); });
    } catch {}
  }
  const u = r.image_url?.trim();
  if (u && !images.includes(u)) images.push(u);
  return images;
}

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
  const jobParam = searchParams.get("job");

  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [singleRecipe, setSingleRecipe] = useState<RecipeOut | null>(null);
  const [siteDomain, setSiteDomain] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.siteId) return;

    api.getSites(params.id).then((sites) => {
      const found = sites.find((s) => s.id === params.siteId);
      if (found) setSiteDomain(found.domain || "");
    }).catch(() => {});

    if (recipeParam) {
      api.getRecipe(recipeParam)
        .then(setSingleRecipe)
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (jobParam) {
      api.getJobGeneratedRecipes(jobParam)
        .then((list) => {
          const forSite = list.filter((r) => r.site_id === params.siteId);
          setFrames(
            forSite.map((r) => ({
              recipeId: r.id,
              title: r.recipe_text?.split("\n")[0]?.trim() || "Recipe",
              images: imagesFromJobRecipe(r),
            }))
          );
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
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
  }, [params.siteId, recipeParam, jobParam]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  if (singleRecipe) {
    return (
      <PinDesigner
        recipeId={singleRecipe.id}
        recipeImages={getRecipeImages(singleRecipe)}
        initialTitle={singleRecipe.recipe_text?.split("\n")[0]?.trim() || "Recipe"}
        initialJson={singleRecipe.pin_design_image?.startsWith("{") ? singleRecipe.pin_design_image : undefined}
        initialTemplateId={singleRecipe.pin_template_id || undefined}
        recipePinTitle={singleRecipe.pin_title ?? ""}
        recipePinDescription={singleRecipe.pin_description ?? ""}
        projectId={params.id}
        siteId={params.siteId}
        website={siteDomain}
        onClose={() =>
          router.push(
            jobParam ? `/projects/${params.id}/sites/all-sites-pins/${jobParam}` : `/projects/${params.id}/sites/${params.siteId}`
          )
        }
      />
    );
  }

  const designerBack = jobParam
    ? `/projects/${params.id}/sites/all-sites-pins/${jobParam}`
    : `/projects/${params.id}/sites/${params.siteId}`;

  return (
    <PinDesigner
      frames={frames}
      projectId={params.id}
      siteId={params.siteId}
      website={siteDomain}
      onClose={() => router.push(designerBack)}
    />
  );
}
