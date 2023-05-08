local http = require "resty.http"
local auths = ngx.shared.auths

function authenticate()

    --- Test Authentication header is set and with a value
    local header = ngx.req.get_headers()['Authorization']
    if header == nil or header:find(" ") == nil then
        return false
    end

    local divider = header:find(' ')
    if header:sub(0, divider-1) ~= 'Basic' then
       return false
    end

    local auth = ngx.decode_base64(header:sub(divider+1))
    if auth == nil or auth:find(':') == nil then
        return false
    end

    divider = auth:find(':')
    local username = auth:sub(0, divider-1)
    local password = auth:sub(divider+1)

    --- Check if authentication is cached
    if auths:get(username) == password then
        ngx.log(ngx.DEBUG, "Authenticated user against Home Assistant (cache).")
        return true
    end

    --- HTTP request against the Supervisor API
    local httpc = http.new()
    local res, err = httpc:request_uri("http://supervisor.local.hass.io/auth", {
        method = "POST",
        body = ngx.encode_args({["username"]=username, ["password"]=password}),
        headers = {
            ["Content-Type"] = "application/x-www-form-urlencoded",
            ["X-Supervisor-Token"] = os.getenv("SUPERVISOR_TOKEN"),
        },
        keepalive_timeout = 60,
        keepalive_pool = 10
    })

    --- Error during API request
    if err then
        ngx.log(ngx.WARN, "Error during Home Assistant user authentication.", err)
        return false
    end

    --- No result? Something went wrong...
    if not res then
        ngx.log(ngx.WARN, "Error during Home Assistant user authentication.")
        return false
    end

    --- Valid response, the username/password is valid
    if res.status == 200 then
        ngx.log(ngx.INFO, "Authenticated user against Home Assistant.")
        auths:set(username, password, 60)
        return true
    end

    --- Whatever the response is, it is invalid
    ngx.log(ngx.WARN, "Authentication against Home Assistant failed!")
    return false
end

-- Only authenticate if its not disabled
if not os.getenv('DISABLE_HA_AUTHENTICATION') then

    --- Try to authenticate against HA
    local authenticated = authenticate()

    --- If authentication failed, throw a basic auth
    if not authenticated then
       ngx.header.content_type = 'text/plain'
       ngx.header.www_authenticate = 'Basic realm="Home Assistant"'
       ngx.status = ngx.HTTP_UNAUTHORIZED
       ngx.say('401 Access Denied')
       ngx.exit(ngx.HTTP_UNAUTHORIZED)
    end
end
