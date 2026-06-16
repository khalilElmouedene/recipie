"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import PinDesigner, { FrameInfo } from "@/components/PinDesigner";
import { api, RecipeOut, GeneratedJobRecipeOut } from "@/lib/api";
import { getUserRole, getUserId } from "@/lib/auth";

function imagesFromJobRecipe(r: GeneratedJobRecipeOut): string[] {
  // Only use generated_images (Midjourney output). Never include image_url,
  // which is the input prompt image used to trigger generation — not the result.
  const images: string[] = [];
  if (r.generated_images) {
    try {
      const arr = JSON.parse(r.generated_images);
      if (Array.isArray(arr)) arr.forEach((url: string) => { if (url?.trim()) images.push(url.trim()); });
    } catch {}
  }
  return images;
}

function getRecipeImages(r: RecipeOut): string[] {
  // Only use generated_images (Midjourney output). Never include image_url,
  // which is the input prompt image used to trigger generation — not the result.
  const images: string[] = [];
  if (r.generated_images) {
    try {
      const arr = JSON.parse(r.generated_images);
      if (Array.isArray(arr)) arr.forEach((url: string) => { if (url?.trim()) images.push(url.trim()); });
    } catch {}
  }
  return images;
}

function titleFromRecipeText(text?: string | null): string {
  return text?.split("\n")[0]?.trim() || "Recipe";
}

function recipeKey(text?: string | null): string {
  return (text?.trim() || titleFromRecipeText(text)).replace(/\s+/g, " ").toLowerCase();
}

function flattenImagesFromJobRecipes(recipes: GeneratedJobRecipeOut[]): string[] {
  return recipes.flatMap(imagesFromJobRecipe).filter(Boolean);
}

function flattenImagesFromRecipes(recipes: RecipeOut[]): string[] {
  return recipes.flatMap(getRecipeImages).filter(Boolean);
}

export default function PinDesignerPage() {
  const params = useParams<{ id: string; siteId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const recipeParam = searchParams.get("recipe");
  const jobParam = searchParams.get("job");

  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [singleRecipe, setSingleRecipe] = useState<RecipeOut | null>(null);
  const [singleRandomImages, setSingleRandomImages] = useState<string[]>([]);
  const [siteDomain, setSiteDomain] = useState("");
  const [embedPinInArticle, setEmbedPinInArticle] = useState(false);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    if (!params.siteId) return;

    api.getSites(params.id).then((sites) => {
      const found = sites.find((s) => s.id === params.siteId);
      if (found) {
        setSiteDomain(found.domain || "");
        setEmbedPinInArticle(found.embed_pin_in_article ?? false);
      }
    }).catch(() => {});

    const globalRole = getUserRole();
    if (globalRole === "owner") {
      setCanManage(true);
    } else {
      const currentUserId = getUserId();
      api.getMembers(params.id)
        .then((members) => {
          const me = members.find((m) => m.user_id.toString() === currentUserId);
          setCanManage(me?.role === "admin");
        })
        .catch(() => {});
    }

    if (recipeParam) {
      api.getRecipe(recipeParam)
        .then(async (recipe) => {
          setSingleRecipe(recipe);
          try {
            const sites = await api.getSites(params.id);
            const otherSiteRecipes = (
              await Promise.all(
                sites
                  .filter((site) => site.id !== params.siteId)
                  .map((site) => api.getRecipes(site.id, "pin_designer").catch(() => [] as RecipeOut[]))
              )
            ).flat().filter((r) => r.status === "generated");
            const currentKey = recipeKey(recipe.recipe_text);
            const sameRecipeImages = flattenImagesFromRecipes(
              otherSiteRecipes.filter((r) => recipeKey(r.recipe_text) === currentKey)
            );
            setSingleRandomImages(sameRecipeImages);
          } catch {
            setSingleRandomImages([]);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (jobParam) {
      Promise.all([
        api.getJobGeneratedRecipes(jobParam, params.siteId),
        api.getJobGeneratedRecipes(jobParam),
        api.getRecipes(params.siteId, "pin_designer").catch(() => [] as RecipeOut[]),
      ])
        .then(([list, allJobRecipes, siteRecipes]) => {
          const recipeById = new Map(siteRecipes.map((recipe) => [recipe.id, recipe]));
          const generatedOnly = list.filter((r) => r.status === "generated");
          const otherSiteRecipes = allJobRecipes.filter((r) => r.status === "generated" && r.site_id !== params.siteId);
          setFrames(
            generatedOnly.map((r) => {
              const title = titleFromRecipeText(r.recipe_text);
              const sameRecipeImages = flattenImagesFromJobRecipes(
                otherSiteRecipes.filter((other) => recipeKey(other.recipe_text) === recipeKey(r.recipe_text))
              );
              return {
                recipeId: r.id,
                title,
                pinTitle: recipeById.get(r.id)?.pin_title?.trim() || r.pin_title?.trim() || undefined,
                images: imagesFromJobRecipe(r),
                randomImages: sameRecipeImages,
              };
            })
          );
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      Promise.all([
        api.getRecipes(params.siteId, "pin_designer"),
        api.getSites(params.id),
      ])
        .then(async ([all, sites]) => {
          const otherSiteRecipes = (
            await Promise.all(
              sites
                .filter((site) => site.id !== params.siteId)
                .map((site) => api.getRecipes(site.id, "pin_designer").catch(() => [] as RecipeOut[]))
            )
          ).flat().filter((r) => r.status === "generated");
          const source = all.filter((r) => r.status === "generated");
          setFrames(source.map((r) => ({
            recipeId: r.id,
            title: titleFromRecipeText(r.recipe_text),
            pinTitle: r.pin_title?.trim() || undefined,
            images: getRecipeImages(r),
            randomImages: (() => {
              const sameRecipeImages = flattenImagesFromRecipes(
                otherSiteRecipes.filter((other) => recipeKey(other.recipe_text) === recipeKey(r.recipe_text))
              );
              return sameRecipeImages;
            })(),
          })));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [params.id, params.siteId, recipeParam, jobParam]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950 text-white">
        Loading...
      </div>
    );
  }

  if (singleRecipe) {
    const recipeImagesForDesigner =
      singleRecipe.status === "generated" ? getRecipeImages(singleRecipe) : [];
    return (
      <PinDesigner
        recipeId={singleRecipe.id}
        recipeImages={recipeImagesForDesigner}
        randomImages={singleRandomImages}
        initialTitle={singleRecipe.recipe_text?.split("\n")[0]?.trim() || "Recipe"}
        initialJson={singleRecipe.pin_design_image?.startsWith("{") ? singleRecipe.pin_design_image : undefined}
        initialTemplateId={singleRecipe.pin_template_id || undefined}
        recipePinTitle={singleRecipe.pin_title ?? ""}
        recipePinDescription={singleRecipe.pin_description ?? ""}
        projectId={params.id}
        siteId={params.siteId}
        website={siteDomain}
        embedPinInArticle={embedPinInArticle}
        canManage={canManage}
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
      embedPinInArticle={embedPinInArticle}
      canManage={canManage}
      onClose={() => router.push(designerBack)}
    />
  );
}
