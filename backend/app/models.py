from __future__ import annotations
import uuid
from datetime import datetime
import re
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=1)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number")
        return v


class LoginRequest(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)

    @model_validator(mode="before")
    @classmethod
    def strip_email(cls, v):
        if isinstance(v, dict) and "email" in v and isinstance(v["email"], str):
            v["email"] = v["email"].strip()
        return v


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    created_at: datetime
    has_password: bool = False

    class Config:
        from_attributes = True

    @classmethod
    def from_user(cls, user) -> "UserOut":
        return cls(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=user.role.value if hasattr(user.role, "value") else user.role,
            created_at=user.created_at,
            has_password=bool(user.password_hash),
        )


class UserCreate(BaseModel):
    email: EmailStr
    password: str | None = None
    full_name: str = Field(min_length=1)
    role: str = "member"


class UserRoleUpdate(BaseModel):
    role: str


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1)
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number")
        return v


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number")
        return v


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ProjectOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    owner_id: uuid.UUID
    created_at: datetime
    site_count: int = 0
    member_count: int = 0
    recipe_count: int = 0
    job_count: int = 0

    class Config:
        from_attributes = True


class MemberAdd(BaseModel):
    user_id: uuid.UUID
    role: str = "member"


class MemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    full_name: str
    role: str

    class Config:
        from_attributes = True


class CredentialSet(BaseModel):
    key_type: str
    value: str


class CredentialOut(BaseModel):
    key_type: str
    masked_value: str
    updated_at: datetime


class PromptOut(BaseModel):
    key: str
    value: str
    description: str


class PromptsUpdate(BaseModel):
    prompts: dict[str, str]  # key -> value


class WpUserItem(BaseModel):
    username: str
    password: str = ""  # empty = keep existing when updating


class SiteCreate(BaseModel):
    domain: str
    wp_url: str
    wp_users: list[WpUserItem] = Field(..., min_length=1, description="At least one WP user")
    sheet_name: str = ""
    spreadsheet_id: str = ""
    pinterest_url: str = ""
    image_mode: str = "featured_and_top"
    embed_pin_in_article: bool = False
    generate_recipe_json: bool = True


class SiteUpdate(BaseModel):
    domain: str | None = None
    wp_url: str | None = None
    wp_users: list[WpUserItem] | None = None
    sheet_name: str | None = None
    spreadsheet_id: str | None = None
    pinterest_url: str | None = None
    image_mode: str | None = None
    embed_pin_in_article: bool | None = None
    generate_recipe_json: bool | None = None
    pin_template_id: str | None = None


class WpUserOut(BaseModel):
    username: str


class PinterestRecipeOut(BaseModel):
    """Enriched recipe row returned by the project pinterest-recipes endpoint."""
    id: str
    site_id: str
    site_domain: str
    recipe_text: str
    generated_images: str | None = None
    image_url: str | None = None
    pin_design_image: str | None = None
    pin_title: str | None = None
    pin_description: str | None = None
    pin_board: str | None = None
    pin_tags: str | None = None
    pin_url: str | None = None
    wp_permalink: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class SiteOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    domain: str
    wp_url: str
    wp_users: list[WpUserOut]
    sheet_name: str
    spreadsheet_id: str
    pinterest_url: str = ""
    image_mode: str = "featured_and_top"
    embed_pin_in_article: bool = False
    generate_recipe_json: bool = True
    pin_template_id: str | None = None
    created_at: datetime
    recipe_count: int = 0

    class Config:
        from_attributes = True


class RecipeCreate(BaseModel):
    image_url: str
    recipe_text: str


class SharedRecipeInput(BaseModel):
    image_url: str
    recipe_text: str


class RecipeUpdate(BaseModel):
    recipe_text: str | None = None
    generated_images: str | None = None
    generated_article: str | None = None
    pin_design_image: str | None = None
    pin_title: str | None = None
    pin_description: str | None = None
    pin_blog_link: str | None = None
    pin_template_id: str | None = None
    pin_url: str | None = None
    pin_board: str | None = None
    pin_tags: str | None = None
    seo_title: str | None = None
    wp_tags: str | None = None


class PinterestPinRequest(BaseModel):
    board_id: str
    title: str | None = None
    description: str | None = None
    link: str | None = None
    image_indices: list[int] | None = None


class PinterestPinResult(BaseModel):
    image_url: str
    pin_id: str | None = None
    pin_url: str | None = None
    error: str | None = None


class PinterestBulkResponse(BaseModel):
    total: int
    created: int
    failed: int
    pins: list[PinterestPinResult]


class RecipeOut(BaseModel):
    id: uuid.UUID
    site_id: uuid.UUID
    created_by: uuid.UUID
    image_url: str
    recipe_text: str
    status: str
    generated_article: str | None = None
    generated_json: str | None = None
    generated_full_recipe: str | None = None
    focus_keyword: str | None = None
    meta_description: str | None = None
    category: str | None = None
    generated_images: str | None = None
    wp_post_id: str | None = None
    wp_permalink: str | None = None
    pin_design_image: str | None = None
    pin_title: str | None = None
    pin_description: str | None = None
    pin_blog_link: str | None = None
    pin_template_id: str | None = None
    pin_url: str | None = None
    pin_board: str | None = None
    pin_tags: str | None = None
    seo_title: str | None = None
    wp_tags: str | None = None
    error_message: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class SiteRecipeCardOut(BaseModel):
    id: uuid.UUID
    title: str
    list_image_url: str | None = None
    status: str
    has_generated_images: bool = False
    focus_keyword: str | None = None
    category: str | None = None
    wp_permalink: str | None = None
    error_message: str | None = None


class SiteRecipeCardPageOut(BaseModel):
    total: int
    pending: int
    generating: int
    generated: int
    published: int
    failed: int
    with_generated_images: int
    items: list[SiteRecipeCardOut]


class JobStart(BaseModel):
    job_type: str
    site_id: uuid.UUID | None = None
    recipe_id: uuid.UUID | None = None
    shared_recipes: list[SharedRecipeInput] | None = None


class JobOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    created_by: uuid.UUID
    job_type: str
    status: str
    current_row: int | None = None
    total_rows: int | None = None
    error: str | None = None
    created_at: datetime
    finished_at: datetime | None = None

    class Config:
        from_attributes = True


class JobPublishSummaryOut(BaseModel):
    total: int
    processed: int
    succeeded: int
    failed: int
    remaining: int


class GeneratedJobRecipeOut(BaseModel):
    id: uuid.UUID
    site_id: uuid.UUID
    site_domain: str
    recipe_text: str
    status: str
    wp_permalink: str | None = None
    image_url: str = ""
    generated_images: str | None = None
    category: str | None = None
    pin_title: str | None = None
    pin_description: str | None = None
    pin_template_id: str | None = None
    created_at: datetime


class GeneratedJobSiteSummaryOut(BaseModel):
    site_id: uuid.UUID
    site_domain: str
    recipe_count: int
    published_count: int


class PublishScheduleOut(BaseModel):
    enabled: bool
    interval_minutes: int
    image_retention_days: int = 4
    next_run_at: datetime | None = None
    last_run_at: datetime | None = None
    last_error: str | None = None


class PublishScheduleUpdate(BaseModel):
    enabled: bool
    interval_minutes: int = Field(ge=1, le=10080)
    image_retention_days: int = Field(ge=1, le=3650)


class PublishBatchRequest(BaseModel):
    """Batch push generated recipes to WordPress in one run."""
    mode: Literal["wordpress_scheduled", "manual_backdate"]
    first_publish_at: datetime | None = None  # base time for first post (wordpress_scheduled)
    interval_minutes: int | None = None  # override project interval
    site_id: uuid.UUID | None = None  # if set, only publish recipes for this site
    recipe_id: uuid.UUID | None = None  # if set, publish only this single recipe
    recipe_ids: list[uuid.UUID] | None = None  # if set, publish only these specific recipes


class PublishBatchOut(BaseModel):
    total: int
    succeeded: int
    failed: int
    errors: list[str] = []


class ImageCleanupRunRequest(BaseModel):
    # If true, delete images for all published recipes regardless of age.
    delete_all_published: bool = False
    # Used when delete_all_published is false.
    published_only: bool = True
    retention_days: int | None = Field(default=None, ge=1, le=3650)


class ImageCleanupRunResult(BaseModel):
    recipes_updated: int
    recipes_deleted: int = 0
    files_deleted: int
    mode: str


# ── Pin Designer Templates (user-created layouts) ───────────────────────────

class PinDesignerTemplateElement(BaseModel):
    id: str
    type: str  # "image" | "text" | "band" | "frame" | "circle"
    label: str
    x: float
    y: float
    width: float
    height: float

    defaultText: str | None = None
    fontFamily: str | None = None
    fontSize: int | None = None
    fontWeight: str | None = None
    fontStyle: str | None = None
    fill: str | None = None
    bgColor: str | None = None
    textAlign: str | None = None
    textVariable: str | None = None
    textTransform: str | None = None
    radius: float | None = None
    strokeWidth: float | None = None
    strokeStyle: dict | str | None = None
    imageUrl: str | None = None
    flipX: bool | None = None
    flipY: bool | None = None
    locked: bool | None = None


class PinDesignerTemplateOut(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str | None = None
    bgColor: str
    canvasWidth: int = 1000
    canvasHeight: int = 1500
    previewLayout: str | None = None
    project_ids: list[str] | None = None
    elements: list[PinDesignerTemplateElement]


class PinDesignerTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    bgColor: str = Field(min_length=1, max_length=50)
    canvasWidth: int = 1000
    canvasHeight: int = 1500
    project_ids: list[str] | None = None
    elements: list[PinDesignerTemplateElement]


class PinDesignerTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    bgColor: str | None = None
    canvasWidth: int | None = None
    canvasHeight: int | None = None
    project_ids: list[str] | None = None
    elements: list[PinDesignerTemplateElement] | None = None


class JobLogOut(BaseModel):
    id: int
    message: str
    created_at: datetime


class AuditLogOut(BaseModel):
    id: uuid.UUID
    occurred_at: datetime
    actor_user_id: uuid.UUID | None = None
    actor_email: str | None = None
    action: str
    table_name: str
    entity_pk: str | None = None
    changed_fields: list[str] | None = None
    old_values: dict | None = None
    new_values: dict | None = None
    request_method: str | None = None
    request_path: str | None = None
    ip_address: str | None = None

    class Config:
        from_attributes = True


class AuditLogListOut(BaseModel):
    total: int
    items: list[AuditLogOut]


class DashboardStats(BaseModel):
    total_projects: int
    total_sites: int
    total_recipes: int
    total_jobs: int
    projects: list[ProjectOut]


# ── Pin Generator ────────────────────────────────────────

class PinTemplateOut(BaseModel):
    id: str
    name: str
    description: str
    image_count: int
    colors: list[str]


class GeneratePinRequest(BaseModel):
    template_id: str
    title: str | None = None
    ingredients: str | None = None
    website: str | None = None
    image_indices: list[int] | None = None


class GeneratePinResponse(BaseModel):
    image_base64: str


class BulkGeneratePinsRequest(BaseModel):
    template_id: str
    website: str | None = None


class BulkPinItem(BaseModel):
    recipe_id: str
    recipe_title: str
    image_base64: str | None = None
    error: str | None = None


class BulkGeneratePinsResponse(BaseModel):
    total: int
    generated: int
    failed: int
    pins: list[BulkPinItem]


class SetupPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number")
        return v
