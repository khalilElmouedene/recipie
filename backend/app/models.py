from __future__ import annotations
import uuid
from datetime import datetime
import re
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


class SiteUpdate(BaseModel):
    domain: str | None = None
    wp_url: str | None = None
    wp_users: list[WpUserItem] | None = None
    sheet_name: str | None = None
    spreadsheet_id: str | None = None


class WpUserOut(BaseModel):
    username: str


class SiteOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    domain: str
    wp_url: str
    wp_users: list[WpUserOut]
    sheet_name: str
    spreadsheet_id: str
    created_at: datetime
    recipe_count: int = 0

    class Config:
        from_attributes = True


class RecipeCreate(BaseModel):
    image_url: str
    recipe_text: str


class RecipeUpdate(BaseModel):
    recipe_text: str | None = None
    generated_images: str | None = None
    pin_design_image: str | None = None
    pin_title: str | None = None
    pin_description: str | None = None
    pin_blog_link: str | None = None


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
    error_message: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class JobStart(BaseModel):
    job_type: str
    site_id: uuid.UUID | None = None
    recipe_id: uuid.UUID | None = None


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


class JobLogOut(BaseModel):
    id: int
    message: str
    created_at: datetime


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
