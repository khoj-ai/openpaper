import logging
from datetime import datetime, timezone
from typing import Any, Dict, Generic, List, Optional, Type, TypeVar, Union

from app.database.database import Base
from app.schemas.user import CurrentUser
from pydantic import BaseModel
from sqlalchemy.orm import Session

# Type variable for SQLAlchemy models
ModelType = TypeVar("ModelType", bound="Base")  # type: ignore
CreateSchemaType = TypeVar("CreateSchemaType", bound=BaseModel)
UpdateSchemaType = TypeVar("UpdateSchemaType", bound=BaseModel)

logger = logging.getLogger(__name__)


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
        self,
        db: Session,
        id: Any,
        *,
        user: Optional[CurrentUser] = None,
        update_last_accessed: bool = False,
    ) -> Optional[ModelType]:
        """Get a single record by ID, optionally filtered by user"""
        try:
            query = db.query(self.model).filter(self.model.id == id)
            query = self._filter_by_user(query, user)
            if update_last_accessed and hasattr(self.model, "last_accessed_at"):
                # Update last accessed timestamp if applicable
                query.update(
                    {self.model.last_accessed_at: datetime.now(timezone.utc)},
                    synchronize_session=False,
                )
                db.commit()
            return query.first()
        except Exception as e:
            logger.error(
                f"Error retrieving {self.model.__name__} with ID {id}: {str(e)}",
                exc_info=True,
            )
            return None

    def get_no_auth(self, db: Session, id: Any) -> Optional[ModelType]:
        """
        Get a single record by ID without user filtering
        RISK: This method should be used with caution as it bypasses user ownership checks. Use sparingly and only if absolutely necessary.
        """
        try:
            return db.query(self.model).filter(self.model.id == id).first()
        except Exception as e:
            logger.error(
                f"Error retrieving {self.model.__name__} with ID {id}: {str(e)}",
                exc_info=True,
            )
            return None

    def get_multi(
        self,
        db: Session,
        *,
        skip: int = 0,
        limit: int = 100,
        user: Optional[CurrentUser] = None,
    ) -> List[ModelType]:
        """Get multiple records with pagination, optionally filtered by user"""
        try:
            query = db.query(self.model)
            query = self._filter_by_user(query, user)
            return query.offset(skip).limit(limit).all()
        except Exception as e:
            logger.error(
                f"Error retrieving multiple {self.model.__name__} objects: {str(e)}",
                exc_info=True,
            )
            return []

    def get_by(
        self, db: Session, *, user: Optional[CurrentUser] = None, **filters
    ) -> Optional[ModelType]:
        """Get a single record by arbitrary filters"""
        try:
            query = db.query(self.model)
            query = self._filter_by_user(query, user)

            # Apply filters
            for field, value in filters.items():
                if hasattr(self.model, field):
                    query = query.filter(getattr(self.model, field) == value)

            return query.first()
        except Exception as e:
            logger.error(
                f"Error retrieving {self.model.__name__} with filters {filters}: {str(e)}",
                exc_info=True,
            )
            return None

    def get_multi_by(
        self,
        db: Session,
        *,
        skip: int = 0,
        limit: int = 100,
        user: Optional[CurrentUser] = None,
        **filters,
    ) -> List[ModelType]:
        """Get multiple records by arbitrary filters"""
        try:
            query = db.query(self.model)
            query = self._filter_by_user(query, user)

            # Apply filters
            for field, value in filters.items():
                if hasattr(self.model, field):
                    query = query.filter(getattr(self.model, field) == value)

            return query.offset(skip).limit(limit).all()
        except Exception as e:
            logger.error(
                f"Error retrieving multiple {self.model.__name__} objects with filters {filters}: {str(e)}",
                exc_info=True,
            )
            return []

    def create(
        self,
        db: Session,
        *,
        obj_in: CreateSchemaType,
        user: Optional[CurrentUser] = None,
    ) -> Optional[ModelType]:
        """Create a new record, optionally associating with a user"""
        try:
            obj_in_data = obj_in.model_dump()
            if user and hasattr(self.model, "user_id"):
                obj_in_data["user_id"] = user.id
            db_obj = self.model(**obj_in_data)
            db.add(db_obj)
            db.commit()
            db.refresh(db_obj)
            return db_obj
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error creating {self.model.__name__}: {str(e)}", exc_info=True
            )
            return None

    def update(
        self,
        db: Session,
        *,
        db_obj: ModelType,
        obj_in: Union[UpdateSchemaType, Dict[str, Any]],
        user: Optional[CurrentUser] = None,
    ) -> Optional[ModelType]:
        """Update a record, verifying user ownership if specified"""
        if user and hasattr(db_obj, "user_id") and db_obj.user_id != user.id:
            logger.warning(
                f"User {user.id} attempted to update {self.model.__name__} owned by another user"
            )
            return None

        try:
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
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error updating {self.model.__name__} with ID {db_obj.id}: {str(e)}",
                exc_info=True,
            )
            return None

    def remove(
        self, db: Session, *, id: Any, user: Optional[CurrentUser] = None
    ) -> Optional[ModelType]:
        """Delete a record, optionally verifying user ownership"""
        try:
            query = db.query(self.model).filter(self.model.id == id)
            query = self._filter_by_user(query, user)
            obj = query.first()
            if obj:
                db.delete(obj)
                db.commit()
                return obj
            return None
        except Exception as e:
            db.rollback()
            logger.error(
                f"Error removing {self.model.__name__} with ID {id}: {str(e)}",
                exc_info=True,
            )
            return None

    def has_any(
        self,
        db: Session,
        *,
        user: CurrentUser,
    ) -> bool:
        """Check if any records exist, optionally filtered by user"""
        try:
            query = db.query(self.model)
            query = self._filter_by_user(query, user)
            return query.count() > 0
        except Exception as e:
            logger.error(
                f"Error checking if any {self.model.__name__} objects exist: {str(e)}",
                exc_info=True,
            )
            return False
