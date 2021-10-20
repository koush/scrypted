export const updatePluginsData = {
    "triggers": [
        {
            "condition": null,
            "id": "scheduler",
            "model": {
                "hour": "03",
                "minute": "15",
                "rpc": {
                    "method": "schedule",
                    "parameters": [
                        {
                            "hour": 3,
                            "minute": 15,
                            "clockType": "AM",
                            "sunday": true,
                            "monday": true,
                            "tuesday": true,
                            "wednesday": true,
                            "thursday": true,
                            "friday": true,
                            "saturday": true
                        }
                    ]
                },
                "clockType": "AM",
                "sunday": true,
                "monday": true,
                "tuesday": true,
                "saturday": true,
                "wednesday": true,
                "thursday": true,
                "friday": true
            }
        }
    ],
    "actions": [
        {
            "id": "update-plugins",
            "model": {
            }
        }
    ],
    "staticEvents": false,
    "denoiseEvents": false,
    "runToCompletion": false,
    "automationType": "Automation"
}
