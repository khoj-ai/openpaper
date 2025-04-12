from typing import Any, Dict, Generic, List, Optional, Type, TypeVar, Union

from app.database.database import Base
from app.database.models import Document
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

# Type variable for SQLAlchemy models
ModelType = TypeVar("ModelType", bound="Base")  # type: ignore
CreateSchemaType = TypeVar("CreateSchemaType", bound=BaseModel)
UpdateSchemaType = TypeVar("UpdateSchemaType", bound=BaseModel)


# Generic CRUD base class with type safety
class CRUDBase(Generic[ModelType, CreateSchemaType, UpdateSchemaType]):
    def __init__(self, model: Type[ModelType]):
        """
        CRUD object with default methods to Create, Read, Update, Delete
        """
        self.model = model

    def _filter_by_user(self, query, user: Optional[CurrentUser] = None):
        """Add user filter to query if model has user_id and user is provided"""
        if user and hasattr(self.model, "user_id"):
            return query.filter(self.model.user_id == user.id)
        return query

    def get(
        self, db: Session, id: Any, *, user: Optional[CurrentUser] = None
    ) -> Optional[ModelType]:
        """Get a single record by ID, optionally filtered by user"""
        query = db.query(self.model).filter(self.model.id == id)
        query = self._filter_by_user(query, user)
        return query.first()

    def get_multi(
        self,
        db: Session,
        *,
        skip: int = 0,
        limit: int = 100,
        user: Optional[CurrentUser] = None
    ) -> List[ModelType]:
        """Get multiple records with pagination, optionally filtered by user"""
        query = db.query(self.model)
        query = self._filter_by_user(query, user)
        return query.offset(skip).limit(limit).all()

    def create(
        self,
        db: Session,
        *,
        obj_in: CreateSchemaType,
        user: Optional[CurrentUser] = None
    ) -> ModelType:
        """Create a new record, optionally associating with a user"""
        obj_in_data = obj_in.model_dump()
        if user and hasattr(self.model, "user_id"):
            obj_in_data["user_id"] = user.id
        db_obj = self.model(**obj_in_data)
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def update(
        self,
        db: Session,
        *,
        db_obj: ModelType,
        obj_in: Union[UpdateSchemaType, Dict[str, Any]],
        user: Optional[CurrentUser] = None
    ) -> ModelType:
        """Update a record, verifying user ownership if specified"""
        if user and hasattr(db_obj, "user_id") and db_obj.user_id != user.id:
            return None  # Or raise an exception if you prefer

        # ...existing update logic...
        if isinstance(obj_in, dict):
            update_data = obj_in
        else:
            update_data = obj_in.model_dump(exclude_unset=True)

        for field in update_data:
            if hasattr(db_obj, field):
                setattr(db_obj, field, update_data[field])

        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def remove(
        self, db: Session, *, id: Any, user: Optional[CurrentUser] = None
    ) -> Optional[ModelType]:
        """Delete a record, optionally verifying user ownership"""
        query = db.query(self.model).filter(self.model.id == id)
        query = self._filter_by_user(query, user)
        obj = query.first()
        if obj:
            db.delete(obj)
            db.commit()
        return obj
