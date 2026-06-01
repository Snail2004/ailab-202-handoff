from flask import Flask

from routes.dataset import bp as dataset_bp
from routes.projects import bp as projects_bp
from routes.validation import bp as validation_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(projects_bp, url_prefix="/api")
    app.register_blueprint(dataset_bp, url_prefix="/api")
    app.register_blueprint(validation_bp, url_prefix="/api")
