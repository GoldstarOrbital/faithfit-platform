# auth service

Stub REST microservice. Port: 4001

## Responsibilities
See section 1 of platform spec for this service's role in the Functioning Faith architecture.

## Run locally
```
npm install
npm start
```

## Docker
```
docker build -t functioning-faith-auth .
docker run -p 4001:4001 functioning-faith-auth
```
