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

export default function PinDesignerPage() {
  const params = useParams<{ id: string; siteId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const recipeParam = searchParams.get("recipe");
  const jobParam = searchParams.get("job");

  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [singleRecipe, setSingleRecipe] = useState<RecipeOut | null>(null);
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
        .then(setSingleRecipe)
        .catch(() => {})
        .finally(() => setLoading(false));
    } else if (jobParam) {
      api.getJobGeneratedRecipes(jobParam, params.siteId)
        .then((list) => {
          const generatedOnly = list.filter((r) => r.status === "generated");
          setFrames(
            generatedOnly.map((r) => ({
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
          const source = all.filter((r) => r.status === "generated");
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
    const recipeImagesForDesigner =
      singleRecipe.status === "generated" ? getRecipeImages(singleRecipe) : [];
    return (
      <PinDesigner
        recipeId={singleRecipe.id}
        recipeImages={recipeImagesForDesigner}
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
