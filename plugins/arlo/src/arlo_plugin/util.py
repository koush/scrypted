import asyncio


class BackgroundTaskMixin:
    def create_task(self, coroutine) -> asyncio.Task:
        task = asyncio.get_event_loop().create_task(coroutine)
        self.register_task(task)
        return task

    def register_task(self, task) -> None:
        if not hasattr(self, "background_tasks"):
            self.background_tasks = set()

        assert task is not None

        def print_exception(task):
            if task.exception():
                self.logger.error(f"task exception: {task.exception()}")

        self.background_tasks.add(task)
        task.add_done_callback(print_exception)
        task.add_done_callback(self.background_tasks.discard)

    def cancel_pending_tasks(self) -> None:
        if not hasattr(self, "background_tasks"):
            return
        for task in self.background_tasks:
            task.cancel()