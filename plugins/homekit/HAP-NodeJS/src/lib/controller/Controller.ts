import {Service} from "../Service";

/**
 * A ControllerServiceMap represents all services used by a Controller.
 * It is up to the Controller to choose unique and persistent names for its services.
 */
export interface ControllerServiceMap {
    [name: string]: Service | undefined,
}

/**
 * ControllerType is basically a string uniquely identifying the type of a {@link Controller}.
 * An {@link Accessory} only allows one type of a {@link Controller} to be configured.
 *
 * There are predefined types {@link DefaultControllerType} for all controller implementations provided by hap-nodejs.
 * You can define custom ControllerTypes if you wish to, but be careful that it does not collide with any known definitions.
 */
export type ControllerType = string | DefaultControllerType;
export const enum DefaultControllerType {
    CAMERA = "camera", // or doorbell
    REMOTE = "remote",
    TV = "tv",
    ROUTER = "router",
    LOCK = "lock",
    CHARACTERISTIC_TRANSITION = "characteristic-transition",
}
export type ControllerIdentifier = string | ControllerType;

export type StateChangeDelegate = () => void;

export interface ControllerConstructor {
    new(): Controller;
}

/**
 * A Controller represents a somewhat more complex arrangement of multiple services which together form a accessory
 * like for example cameras, remotes, tvs or routers.
 * Controllers implementing this interface are capable of being serialized and thus stored on and recreated from disk.
 * Meaning services, characteristic configurations and optionally additional controller states can be persistently saved.
 * As a result, implementors of this interface need to follow strict guidelines on how to initialize their
 * services and characteristics.
 *
 * The set of services can change though over the lifespan of the implementation (e.g. protocol changes imposed by HAP like
 * the addition of secure-video for cameras).
 * Such changes can be made using {@link initWithServices}. See below for more infos.
 *
 * The constructor of a Controller should only initialize controller specific configuration and states
 * and MUST NOT create any services or characteristics.
 * Additionally it must implement all necessary methods as noted below. Those methods will get called
 * when the accessory gets added to an Accessory or a Accessory is restored from disk.
 */
export interface Controller<M extends ControllerServiceMap = ControllerServiceMap> {

    /**
     * Every instance of a Controller must define appropriate identifying material.
     * The returned identifier MUST NOT change over the lifetime of the Controller object.
     *
     * Note: The controller can choose to return the same identifier for all controllers of the same type.
     * This will result in the user only being able to add ONE instance of an Controller to an accessory.
     *
     * Some predefined identifiers can be found in {@link ControllerIdentifier}.
     */
    controllerId(): ControllerIdentifier;

    /**
     * This method is called by the accessory the controller is added to. This method is only called if a new controller
     * is constructed (aka the controller is not restored from disk {@see initWithServices}).
     * It MUST create all needed services and characteristics.
     * It MAY create links between services or mark them as hidden or primary.
     * It MUST NOT configure any event handlers.
     * The controller SHOULD save created services in internal properties for later access.
     *
     * The method must return all created services in a ServiceMap.
     * A {@link ControllerServiceMap} basically maps a name to every service on the controller.
     * It is used to potentially recreate a controller for a given ServiceMap using {@link initWithServices}.
     *
     * The set of services represented by the Controller MUST remain static and can only change over new version of
     * the Controller implementation (see {@link initWithServices})
     *
     * @returns a {@link ControllerServiceMap} representing all services of a controller indexed by a controller chosen name.
     */
    constructServices(): M;

    /**
     * This method is called to initialize the controller with already created services.
     * The controller SHOULD save the passed services in internal properties for later access.
     *
     * The controller can return a ServiceMap to signal that the set of services changed.
     * A Controller MUST modify the ServiceMap which is passed to the method and MUST NOT create a new one (to support inheritance).
     * It MUST NOT return a ServiceMap if the service configuration did not change!
     * It MUST be able to restore services using a ServiceMap from any point in time.
     *
     * @param serviceMap {ControllerServiceMap} - represents all services of a controller indexed by the controller chosen name.
     * @returns optionally a {ControllerServiceMap}. This can be used to alter the services configuration of a controller.
     */
    initWithServices(serviceMap: M): M | void;

    /**
     * This method is called to configure the services and their characteristics of the controller.
     * When this method is called, it is guaranteed that either {@link constructServices} or {@link initWithServices}
     * were called before and all services are already created.
     *
     * This method SHOULD set up all necessary event handlers for services and characteristics.
     */
    configureServices(): void;

    /**
     * This method is called once the Controller is removed from the accessory.
     * The controller MUST reset everything to its initial state (just as it would have been constructed freshly)
     * form the constructor.
     * Adding the Controller back to an accessory after it was removed MUST be supported!
     * If the controller is a {@link SerializableController} it MUST NOT call the {@link StateChangeDelegate}
     * as a result of a call to this method.
     *
     * All service contained in the {@link ControllerServiceMap} returned by {@link constructServices}
     * will be automatically removed from the Accessory. The Controller MUST remove any references to those services.
     */
    handleControllerRemoved(): void;

    /**
     * This method is called to signal a factory reset of the controller and its services and characteristics.
     * A controller MUST reset any configuration or states to default values.
     *
     * This method is called once the accessory gets unpaired or the Controller gets removed from the Accessory.
     */
    handleFactoryReset?(): void;

}

/**
 * A SerializableController is a Controller which additionally carries states/data (beside services and characteristics)
 * which needs to be persistently stored. For example current target configuration for an AppleTV remote.
 */
export interface SerializableController<M extends ControllerServiceMap = ControllerServiceMap, S = any> extends Controller<M> {
    /**
     * This method can be used to persistently save controller related configuration across reboots.
     * It should return undefined, if the controller data was reset to default values and nothing needs to be stored anymore.
     *
     * @returns an arbitrary Controller defined object containing all necessary data
     */
    serialize(): S | undefined;

    /**
     * This method is called to restore the controller state from disk.
     * This is only called once, when the data was loaded from disk and the Accessory is to be published.
     * A controller MUST provide backwards compatibility for any configuration layout exposed at any time.
     * A Controller MUST NOT depend on any specific calling order.
     *
     * @param serialized
     */
    deserialize(serialized: S): void;

    /**
     * This method is inherited from {@link Controller.handleFactoryReset} though is required with {@link SerializableController}.
     */
    handleFactoryReset(): void;

    /**
     * This method is called once upon setup. It supplies a function used by the Controller to signal state changes.
     * The implementing controller SHOULD store the function and call it every time the internal controller state changes.
     * It should be expected that the {@link serialize} method will be called next and that the state will be stored
     * to disk.
     * The delegate parameter can be undefined when the controller is removed and the state change delegate is reset.
     *
     * @param delegate {StateChangeDelegate} - the delegate to call when controller state has changed
     */
    setupStateChangeDelegate(delegate?: StateChangeDelegate): void;
}

export function isSerializableController(controller: Controller): controller is SerializableController {
    return "serialize" in controller && "deserialize" in controller && "setupStateChangeDelegate" in controller;
}
